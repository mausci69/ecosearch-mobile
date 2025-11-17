# EcoSearch Architecture

EcoSearch is organised as a monorepo with multiple services:

- **apps/web** : Next.js frontend for user interaction
- **services/api** : FastAPI backend exposing REST endpoints
- **services/worker** : background job processor for ingestion, OCR, and indexing
- **infra** : docker-compose, proxy, and local services (Postgres, Redis, MinIO)
- **config** : YAML configuration for models and policy
- **scripts** : helper scripts for development and operations
- **docs** : documentation

## Data Flow

1. User uploads a document through the web app.
2. API stores metadata and enqueues a job for the worker.
3. Worker performs ingestion, OCR, chunking, and indexing.
4. Query requests go through API → retrieval pipeline (dense, rerank) → agentic decision.
5. Results are returned to the web app for display.

