# EcoSearch Mobile Preview Demo Script

Date: 2026-07-06

## Goal

Show that EcoSearch Mobile can query a prepared corpus inside the standalone iOS preview app, with visible evidence and tunable semantic/lexical retrieval balance.

## Demo flow

1. Open EcoSearch Mobile on iPhone.
2. Show that a prepared corpus is loaded.
3. Show the semantic/lexical ratio control.
4. Ask: “What are closed-book QA systems?”
5. Tap “Retrieve best chunk”.
6. Show the candidate passage, guiding question, summary, score, and top passage.
7. Explain: corpus preparation still uses an OpenAI key, but retrieval over a prepared corpus can run locally.
8. Mention that the retrieval flow was validated in airplane mode.

## Short narration

EcoSearch Mobile is a local-first evidence retrieval app for documents.

In this preview, I’m querying a prepared corpus directly inside the standalone iOS app. The app retrieves supporting text first, keeps the evidence visible, and exposes the semantic/lexical balance used by the retrieval system.

Corpus preparation still uses an OpenAI key, but once the corpus is prepared, the core retrieval workflow can run locally. I validated this retrieval flow in airplane mode.

The goal is not chatbot-first generation, but transparent evidence access before generation.
