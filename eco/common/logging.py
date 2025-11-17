"""
Structured JSON logging + config loader for Agentic EcoSearch.

Usage:
    from eco.common.logging import JSONLLogger, load_configs, cfg_fingerprint

    cfg = load_configs(config_dir="config")
    logger = JSONLLogger(cfg["policy"]["logging"]["jsonl_path"], level=cfg["policy"]["logging"]["level"],
                         cfg_id=cfg_fingerprint(cfg))
    logger.info("startup", {"msg": "EcoSearch booted", "cfg_id": logger.cfg_id})
"""
from __future__ import annotations

import os
import json
import time
import hashlib
import pathlib
import datetime as _dt
from typing import Any, Dict, Optional

try:
    import yaml  # type: ignore
except Exception as e:
    yaml = None  # We fall back to a minimal loader if PyYAML is not present.


def _safe_mkdirs(path: str) -> None:
    pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)


class JSONLLogger:
    """Very small JSON Lines logger with ISO timestamps and optional cfg/version stamping."""
    def __init__(self, jsonl_path: str, level: str = "INFO", cfg_id: Optional[str] = None) -> None:
        self.jsonl_path = jsonl_path
        self.level = level.upper()
        self.cfg_id = cfg_id
        _safe_mkdirs(jsonl_path)

    def _emit(self, level: str, event: str, payload: Dict[str, Any]) -> None:
        if self._level_allows(level):
            row = {
                "ts": _dt.datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
                "level": level,
                "event": event,
                "payload": payload,
            }
            if self.cfg_id:
                row["cfg_id"] = self.cfg_id
            with open(self.jsonl_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    def _level_allows(self, level: str) -> bool:
        order = ["DEBUG", "INFO", "WARNING", "ERROR"]
        try:
            return order.index(level) >= order.index(self.level)
        except ValueError:
            return True

    # Convenience methods
    def debug(self, event: str, payload: Dict[str, Any]) -> None:
        self._emit("DEBUG", event, payload)

    def info(self, event: str, payload: Dict[str, Any]) -> None:
        self._emit("INFO", event, payload)

    def warning(self, event: str, payload: Dict[str, Any]) -> None:
        self._emit("WARNING", event, payload)

    def error(self, event: str, payload: Dict[str, Any]) -> None:
        self._emit("ERROR", event, payload)


def _load_yaml_file(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    if yaml is None:
        # Minimal, unsafe YAML->JSON-like loader fallback (expects JSON subset)
        return json.loads(text)
    return yaml.safe_load(text)


def load_configs(config_dir: str = "config") -> Dict[str, Dict[str, Any]]:
    """Load policy.yaml and models.yaml from the given directory."""
    policy_path = os.path.join(config_dir, "policy.yaml")
    models_path = os.path.join(config_dir, "models.yaml")
    policy = _load_yaml_file(policy_path)
    models = _load_yaml_file(models_path)
    return {"policy": policy, "models": models}


def cfg_fingerprint(cfg: Dict[str, Dict[str, Any]]) -> str:
    """Stable fingerprint of loaded configs (useful for drift/rollback audits)."""
    blob = json.dumps(cfg, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:12]
