Agentic EcoSearch — Starter Config & Logging

Files created:
- config/policy.yaml
- config/models.yaml
- eco/common/logging.py

How to use in your backend (example):

from eco.common.logging import JSONLLogger, load_configs, cfg_fingerprint

cfg = load_configs(config_dir="config")
logger = JSONLLogger(cfg["policy"]["logging"]["jsonl_path"],
                     level=cfg["policy"]["logging"]["level"],
                     cfg_id=cfg_fingerprint(cfg))

logger.info("startup", {"message": "EcoSearch started"})

