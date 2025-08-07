import os
import io
import json
import requests
import streamlit as st

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

if "corpus_json" not in st.session_state:
    st.session_state["corpus_json"] = None

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

    # Use a stable key for file uploader
    uploaded_file = st.file_uploader("Upload a .txt file", type=["txt"], key="txt_file")

    # Track file state across reruns
    current_file = uploaded_file.name if uploaded_file else None
    previous_file = st.session_state.get("previous_file")

    # Save current file name for next run
    st.session_state["previous_file"] = current_file

    # 🔁 Detect file removal and reset everything
    if previous_file and not current_file:
        st.warning("🧹 File removed — clearing session and resetting UI...")
        st.session_state.clear()
        st.rerun()

    # ✅ If file is uploaded, allow corpus preparation
    if uploaded_file:
        sample_text = uploaded_file.read().decode("utf-8")

        if st.button("📚 Prepare Corpus"):
            st.info("⏳ Sending request to backend...")
            response = requests.post(
                f"{BACKEND_URL}/prepare_corpus",
                json={"text": sample_text}
            )
            if response.ok:
                filename = response.json()["file"]
                st.session_state["latest_file"] = filename
                st.success(f"✅ {response.json()['status']}, chunks: {response.json()['chunks']}")
                corpus_response = requests.get(f"{BACKEND_URL}/get_corpus_json")
                if corpus_response.ok:
                    st.session_state["corpus_json"] = corpus_response.content
                    st.session_state["corpus_prepared"] = True
            else:
                st.error(f"❌ Error: {response.status_code} — {response.text}")

        if st.session_state.get("corpus_prepared") and st.session_state.get("corpus_json"):
            st.download_button(
                label="📥 Download Corpus JSON",
                data=st.session_state["corpus_json"],
                file_name=st.session_state.get("latest_file", "corpus_data.json"),
                mime="application/json"
            )
    else:
        st.info("📂 Please upload a .txt file to get started.")

elif mode == "Query":
    st.header("🔍 Query Corpus")

    uploaded_file = st.file_uploader("Upload your chunk_questions JSON", type="json", key="query_file")

    if "corpus_loaded" not in st.session_state:
        st.session_state["corpus_loaded"] = False

    # Track current vs previous file to detect changes or removal
    current_file = uploaded_file.name if uploaded_file else None
    previous_file = st.session_state.get("query_previous_file")

    # Detect file removal
    if previous_file and not current_file:
        st.warning("🧹 File removed — clearing query results.")
        for key in ["query_result", "fallback_result", "eco_answer", "query_input"]:
            st.session_state.pop(key, None)
        st.session_state["corpus_loaded"] = False
        st.session_state["query_previous_file"] = None

    # Load new file
    if uploaded_file and not st.session_state["corpus_loaded"]:
        temp_path = f"temp_{uploaded_file.name}"
        with open(temp_path, "wb") as f:
            f.write(uploaded_file.read())
        with st.spinner("Uploading to backend..."):
            res = requests.post(f"{BACKEND_URL}/load_corpus_file?file_path={temp_path}")
        if res.ok:
            st.success("✅ Corpus loaded.")
            st.session_state["corpus_loaded"] = True
            st.session_state["query_previous_file"] = current_file
            for key in ["query_result", "fallback_result", "eco_answer", "query_input"]:
                st.session_state.pop(key, None)
        else:
            st.error("❌ Failed to load corpus.")
            st.session_state["corpus_loaded"] = False

    # Query logic
    if st.session_state.get("corpus_loaded"):
        question = st.text_input("💬 Ask your question:", key="query_input")

        if st.button("🔍 Retrieve best chunk", key="search_button") and question.strip():
            with st.spinner("Searching..."):
                response = requests.post(f"{BACKEND_URL}/query", json={"question": question})

            if response.ok:
                result = response.json()
                print("🌐 QUERY RESULT:", result)  # temporary print

                if not result or "chunk" not in result:
                    st.error("❌ Error: No valid chunk returned from backend.")
                    st.json(result)
                    st.stop()

                # ✅ Store results in session state
                st.session_state.query_result = result
                st.session_state.top_chunk = result.get("chunk", "")
                st.session_state.top_summary = result.get("summary", "")
                st.session_state.top_score = result.get("score", 0.0)
                st.session_state.cosine_score = result.get("cosine_score", 0.0)
                st.session_state.top_answer = ""

                # ✅ Clear any previous fallback results
                st.session_state.fallback_chunk = ""
                st.session_state.fallback_sentences = []
                st.session_state.fallback_answer = ""


    # === Display Top Matched Chunk (safe rendering + debug) ===
    if st.session_state.get("query_result"):
        result = st.session_state["query_result"]
        print("✅ RENDERING CHUNK LENGTH:", len(result.get("chunk", "")))
        print("✅ RENDERING CHUNK PREVIEW:", repr(result.get("chunk", ""))[:200])


        st.markdown("### 📎 Top Matched Chunk (Raw Code View)")
        st.code(result.get("chunk", "⚠️ No chunk returned."), language="text")

        st.caption(f"Relevance Score (Cross-Encoder): {result.get('score', 0):.3f}")
        st.caption(f"Cosine Similarity (FAISS): {result.get('cosine_score', 0):.3f}")

        # Optional: show full structure for debugging
        with st.expander("📦 Full Query Result JSON"):
            st.json(result)

        # === Action Buttons ===
        st.markdown("### 🤖 What would you like to do next?")
        col1, col2 = st.columns(2)
        with col1:
            if st.button("💬 Answer from this chunk"):
                with st.spinner("Generating answer from chunk..."):
                    res = requests.post(
                        f"{BACKEND_URL}/llm_answer_from_chunk",
                        json={"question": result["question"], "chunk": result["chunk"]}
                    )
                    if res.ok:
                        st.session_state["eco_answer"] = res.json().get("answer", "")
                        st.session_state["fallback_result"] = None

        with col2:
            if not st.session_state.fallback_chunk:
                if st.button("🔍 Use fallback (scan corpus)"):
                    with st.spinner("Asking LLM to find fallback chunk..."):
                        res = requests.post(
                            f"{BACKEND_URL}/fallback",
                            json={"question": st.session_state.query_result["question"]}
                        )
                        if res.ok:
                            fallback_result = res.json()
                            st.session_state.fallback_result = fallback_result
                            st.session_state.fallback_chunk = fallback_result.get("chunk", "")
                            st.session_state.fallback_sentences = fallback_result.get("sentences", [])
                            st.session_state.fallback_answer = ""
                            st.session_state.top_answer = ""
            else:
                if st.button("💬 Answer from fallback chunk"):
                    with st.spinner("Answering from fallback chunk..."):
                        res = requests.post(
                            f"{BACKEND_URL}/answer",
                            json={
                                "question": st.session_state.query_result["question"],
                                "chunk": st.session_state.fallback_chunk
                            }
                        )
                        if res.ok:
                            st.session_state.fallback_answer = res.json().get("answer", "No answer returned.")

        # Show answer from top (EcoSearch) chunk
        if st.session_state.top_answer:
            st.markdown("### 🤖 Answer from EcoSearch Chunk")
            st.success(st.session_state.top_answer)

        # Show answer from fallback chunk
        if st.session_state.fallback_answer:
            st.markdown("### 🤖 Answer from Fallback Chunk")
            st.info(st.session_state.fallback_answer)


    # === Fallback Display ===
    if st.session_state.get("fallback_result"):
        fallback = st.session_state["fallback_result"]
        st.markdown("### 🆘 Fallback: Top LLM-selected Passage")
        st.markdown(fallback["fallback_chunk"])

    # ADDED TO CHECK CHUNK NOT DISPLAYED
    st.markdown("### ✅ DIAGNOSTIC")
    st.write("📦 chunk_text is:", chunk_text[:100] if chunk_text else "[EMPTY]")
    st.write("📦 full query_result is:", query_result)


    # === Display Top Matched Chunk ===
    query_result = st.session_state.get("query_result")
    if query_result and "chunk" in query_result:
        st.markdown("### 📎 Top Matched Chunk")
        st.markdown(query_result["chunk"])
        st.caption(f"Relevance Score (Cross-Encoder): {query_result.get('score', 0):.3f}")
        st.caption(f"Cosine Similarity (FAISS): {query_result.get('cosine_score', 0):.3f}")

    # === Final Answer ===
    eco_answer = st.session_state.get("eco_answer")
    if isinstance(eco_answer, str) and eco_answer.strip():
        st.markdown("### 💬 Answer")
        print("🧠 QUERY RESULT STILL EXISTS?", "query_result" in st.session_state)
        print("🧠 CHUNK STILL THERE?", st.session_state.get("query_result", {}).get("chunk", "[none]")[:100])

# === Run with ===
# streamlit run eco_web.py