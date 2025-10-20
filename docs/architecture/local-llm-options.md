# Local Summarisation + Question Generation Options

## Goal
Design offline summarisation and question generation paths for EcoSearch Mobile.

---

### 1. Llama.cpp (preferred)
- Run Mistral 7B (Q4_K_M quantisation)
- Invoked via React Native bridge or WebAssembly
- Model files: stored in app sandbox (~4–6 GB)
- Ideal for modern phones with ≥8 GB RAM

### 2. GGUF + WebAssembly
- Pure device execution (no bridge)
- Lower accuracy, smaller footprint
- Recommended for mid-range phones (4–6 GB RAM)

### 3. Queue-only Mode
- Device skips generation, enqueues tasks
- Server enriches results when online
- Guarantees universal fallback

---

### Implementation Order
1. Add placeholder “local generation” module (`src/lib/llm/localGen.ts`)
2. Define `generateSummary(text)` and `generateQuestions(text)` stubs
3. Later wire llama.cpp bridge or WASM engine
4. Integrate offline queue with sync API

---

### References
- [llama.cpp bindings for React Native](https://github.com/react-native-llama)
- [GGUF format](https://github.com/ggerganov/llama.cpp/blob/master/docs/gguf.md)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)

