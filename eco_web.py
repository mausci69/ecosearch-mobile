import os
import io
import json
import numpy as np
import pandas as pd
import requests
import streamlit as st
import faiss
from datetime import datetime as dt
from sentence_transformers import SentenceTransformer
import tempfile

BACKEND_URL = "http://localhost:8000"

st.set_page_config(page_title="EcoSearch", page_icon="🌱")

st.title("🌱 EcoSearch — Retrieval-Augmented QA")

if "top_chunk" not in st.session_state:
    st.session_state.top_chunk = ""
if "top_summary" not in st.session_state:
    st.session_state.top_summary = ""
if "top_score" not in st.session_state:
    st.session_state.top_score = 0.0
if "cosine_score" not in st.session_state:
    st.session_state.cosine_score = 0.0
if "top_answer" not in st.session_state:
    st.session_state.top_answer = ""

if "fallback_chunk" not in st.session_state:
    st.session_state.fallback_chunk = ""
if "fallback_sentences" not in st.session_state:
    st.session_state.fallback_sentences = []
if "fallback_answer" not in st.session_state:
    st.session_state.fallback_answer = ""


mode = st.sidebar.selectbox("Select mode", 
                            ["Home", "Generate", "Query", "Evaluate"]
)

# 🔁 Reset session state when switching modes
if "active_mode" not in st.session_state or st.session_state["active_mode"] != mode:
    st.session_state.clear()
    st.session_state["active_mode"] = mode


st.sidebar.info("Use the sidebar to switch modes.")

if "corpus_loaded" not in st.session_state:
    st.session_state["corpus_loaded"] = False

if "corpus_prepared" not in st.session_state:
    st.session_state["corpus_prepared"] = False

if mode == "Home":
    st.header("🏠 Welcome to EcoSearch 👋")
    st.write(
        """
        **EcoSearch** is a Retrieval-Augmented Generation (RAG) prototype.

        - 📚 **Generate**: Upload text, split into chunks, generate summaries & questions.
        - 🔍 **Query**: Upload an existing corpus JSON and ask questions.
        - 📊 **Evaluate**: Upload a test set and corpus JSON to calculate Oracle Overlap — comparing each generated answer with an ideal three-sentence passage extracted by the LLM.

        """
    )

elif mode == "Generate":
    st.header("📚 Generate Corpus")

    uploaded_file = st.file_uploader("Upload a .txt file", type=["txt"], key="txt_file")
    current_file = uploaded_file.name if uploaded_file else None
    previous_file = st.session_state.get("previous_file")
    st.session_state["previous_file"] = current_file

    if previous_file and not current_file:
        st.warning("🧹 File removed — clearing session and resetting UI...")
        st.session_state.clear()
        st.rerun()

    if uploaded_file:
        sample_text = uploaded_file.read().decode("utf-8")
        timestamp = dt.now().strftime("%d%m%Y_%H%M%S")
        download_name = f"chunk_questions_{timestamp}.json"

        if st.button("📚 Prepare Corpus"):
            st.info("⏳ Sending request to backend...")
            response = requests.post(
                f"{BACKEND_URL}/prepare_corpus",
                json={"text": sample_text}
            )
            if response.ok:
                st.session_state["corpus_prepared"] = True
                st.success(f"✅ {response.json()['status']}, chunks: {response.json()['chunks']}")
            else:
                st.error(f"❌ Error: {response.status_code} — {response.text}")

        # Show download button directly after preparation
        if st.session_state.get("corpus_prepared"):
            response = requests.get(f"{BACKEND_URL}/download_corpus_json")
            if response.ok:
                st.download_button(
                    label="📥 Download Corpus JSON",
                    data=response.content,
                    file_name=download_name,
                    mime="application/json"
                )
            else:
                st.error("❌ Failed to fetch corpus JSON from backend.")

elif mode == "Query":
    st.header("🔍 Query Corpus")

    # Upload only chunk_questions.json
    uploaded_file = st.file_uploader("Upload your chunk_questions JSON", type="json", key="query_file")

    # Track loaded state and file
    if "corpus_loaded" not in st.session_state:
        st.session_state["corpus_loaded"] = False
    previous_file = st.session_state.get("query_previous_file")
    current_file = uploaded_file.name if uploaded_file else None

    # File removal detection
    if previous_file and not current_file:
        st.warning("🧹 File removed — clearing query results.")
        for key in [
            "corpus_loaded", "query_previous_file", "query_result",
            "eco_answer", "fallback_chunk", "fallback_sentences", "fallback_answer", "fallback_ready", "query_input"
        ]:
            st.session_state.pop(key, None)

    # On new file upload, process and load into backend
    if uploaded_file and (not st.session_state["corpus_loaded"] or current_file != previous_file):
        temp_path = f"temp_{uploaded_file.name}"
        with open(temp_path, "wb") as f:
            f.write(uploaded_file.read())
        with st.spinner("Uploading corpus to backend..."):
            res = requests.post(f"{BACKEND_URL}/load_corpus_file?file_path={temp_path}")
        if res.ok:
            st.success("✅ Corpus loaded.")
            st.session_state["corpus_loaded"] = True
            st.session_state["query_previous_file"] = uploaded_file.name
            # Clear previous results
            for key in ["query_result", "eco_answer", "fallback_chunk", "fallback_sentences", "fallback_answer", "fallback_ready", "query_input"]:
                st.session_state.pop(key, None)
        else:
            st.error("❌ Failed to load corpus.")
            st.session_state["corpus_loaded"] = False

    # Only show question input if corpus loaded
    if st.session_state.get("corpus_loaded"):
        question = st.text_input("💬 Ask your question:", key="query_input")

        # Query the backend for top chunk
        if st.button("🔍 Retrieve best chunk", key="search_button") and question.strip():
            with st.spinner("Searching..."):
                response = requests.post(f"{BACKEND_URL}/query", json={"question": question})
            if response.ok:
                result = response.json()
                if not result or "chunk" not in result:
                    st.error("❌ Error: No valid chunk returned from backend.")
                    st.json(result)
                    st.stop()
                st.session_state.query_result = result
                st.session_state.eco_answer = ""
                st.session_state.fallback_chunk = ""
                st.session_state.fallback_answer = ""
                st.session_state.fallback_ready = False
            else:
                st.error("❌ Backend error during query.")
                st.stop()

    # === Display Results ===
    query_result = st.session_state.get("query_result")
    eco_answer = st.session_state.get("eco_answer", "").strip()
    fallback_chunk = st.session_state.get("fallback_chunk", "")
    fallback_answer = st.session_state.get("fallback_answer", "")

    if query_result and "chunk" in query_result:
        st.markdown("### 📎 Top Matched Chunk")
        st.markdown(query_result["chunk"])
        st.caption(f"Relevance Score (Cross-Encoder): {query_result.get('score', 0):.3f}")
        st.caption(f"Cosine Similarity (FAISS): {query_result.get('cosine_score', 0):.3f}")

        st.markdown("### 🤖 What would you like to do next?")
        col1, col2 = st.columns(2)

        # Button: LLM answer from EcoSearch chunk
        with col1:
            if st.button("💬 Answer from this chunk"):
                with st.spinner("Generating answer from chunk..."):
                    res = requests.post(
                        f"{BACKEND_URL}/llm_answer_from_chunk",
                        json={"question": query_result["question"], "chunk": query_result["chunk"]}
                    )
                    if res.ok:
                        st.session_state["eco_answer"] = res.json().get("answer", "")
                        st.session_state["fallback_answer"] = ""
                        st.rerun()

        # Button: Use fallback LLM scan
        with col2:
            if not st.session_state.get("fallback_ready"):
                if st.button("🔍 Use fallback (scan corpus)"):
                    with st.spinner("Asking LLM to find fallback chunk..."):
                        res = requests.post(
                            f"{BACKEND_URL}/fallback",
                            json={"question": query_result["question"]}
                        )
                        if res.ok:
                            fallback = res.json()
                            st.session_state["fallback_chunk"] = fallback.get("chunk", "")
                            st.session_state["fallback_ready"] = True

                            # Auto-trigger fallback answer
                            fb_chunk = fallback.get("chunk", "")
                            answer_res = requests.post(
                                f"{BACKEND_URL}/llm_answer_from_chunk",
                                json={
                                    "question": query_result["question"],
                                    "chunk": fb_chunk
                                }
                            )
                            if answer_res.ok:
                                st.session_state["fallback_answer"] = answer_res.json().get("answer", "")
                            else:
                                st.session_state["fallback_answer"] = "*LLM request failed.*"
                            st.rerun()

        # Optional: show fallback answer button if fallback is ready (not strictly needed)
        # (Or you can just show the answer below.)

    # === Display EcoSearch LLM answer ===
    if eco_answer:
        st.markdown("### 💬 Answer from Top Chunk")
        st.info(eco_answer)

    # === Display Fallback Chunk and Answer ===
    if fallback_chunk:
        st.markdown("### 🆘 Fallback: Top LLM-selected Passage")
        st.markdown(fallback_chunk)
        if fallback_answer:
            st.markdown("#### 💬 Fallback LLM Answer")
            st.info(fallback_answer)

elif mode == "Evaluate":
    st.markdown("### 📊 Evaluate Retrieval Performance (Top-1 Reranked Chunk vs LLM Oracle)")

    test_set_file = st.file_uploader("Upload test_set.json", type=["json"], key="test_set")
    corpus_file = st.file_uploader("Upload chunk_questions.json", type=["json"], key="corpus_json")
    txt_file = st.file_uploader("Upload original .txt corpus", type=["txt"], key="corpus_txt")

    if test_set_file and corpus_file and txt_file:
        test_set = json.load(test_set_file)
        corpus_data = json.load(corpus_file)

        # --- Save corpus JSON to a temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as tmp:
            tmp.write(json.dumps(corpus_data).encode("utf-8"))
            tmp_path = tmp.name

        # --- Save the uploaded .txt file to a temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as txt_tmp:
            txt_tmp.write(txt_file.read())
            txt_path = txt_tmp.name

        # --- Tell backend to load the corpus JSON
        response = requests.post(
            f"{BACKEND_URL}/load_corpus_file?file_path={tmp_path}"
        )
        if response.ok:
            st.success("✅ Corpus loaded for evaluation.")
        else:
            st.error("❌ Error loading corpus for evaluation.")
            st.stop()

        # --- Run Evaluation button
        if st.button("Run Evaluation"):
            with st.spinner("Evaluating..."):
                payload = {
                    "test_set": test_set,
                    "corpus": corpus_data,
                    "corpus_file_path": txt_path
                }
                res = requests.post(f"{BACKEND_URL}/evaluate", json=payload, timeout=300)
                if res.ok:
                    results = res.json()
                    # --- Gestione headline e tabella leggibile ---
                    if "results" in results:
                        import pandas as pd
                        df = pd.DataFrame(results["results"])
                        total = len(df)
                        full = (df['overlap'] == 'FULL').sum()
                        partial = (df['overlap'] == 'PARTIAL').sum()
                        full_partial = full + partial
                        full_partial_pct = int(round(100 * full_partial / total)) if total else 0
                        full_pct = int(round(100 * full / total)) if total else 0
                        headline = f"{full_partial_pct}-{full_pct}"

                        st.markdown(
                            (
                                f"<div style='font-size:2em; font-weight:700; margin-bottom:0.5em;'>"
                                f"{headline}"
                                f"</div>"
                            ),
                            unsafe_allow_html=True
                        )

                        st.dataframe(df)
                        csv = df.to_csv(index=False).encode('utf-8')
                        st.download_button(
                            label="📥 Download Results as CSV",
                            data=csv,
                            file_name="evaluation_results.csv",
                            mime="text/csv"
                        )
                    else:
                        st.error("Results in unexpected format!")
                else:
                    st.error(f"Error: {res.status_code} {res.text}")

# === Run with ===
# streamlit run eco_web.py