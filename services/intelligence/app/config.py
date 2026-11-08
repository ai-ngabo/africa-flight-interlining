import json
import os
from functools import lru_cache
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", SERVICE_DIR.parent.parent / "data"))
KNOWLEDGE_DIR = Path(os.environ.get("KNOWLEDGE_DIR", SERVICE_DIR / "knowledge"))
MODEL_DIR = Path(os.environ.get("MODEL_DIR", SERVICE_DIR / "models"))

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1:8b")
CHROMA_URL = os.environ.get("CHROMA_URL")


@lru_cache
def visa_rules() -> dict:
    return json.loads((DATA_DIR / "visa_rules.json").read_text(encoding="utf-8"))


@lru_cache
def carriers() -> dict[str, dict]:
    data = json.loads((DATA_DIR / "carriers.json").read_text(encoding="utf-8"))
    return {c["code"]: c for c in data["carriers"]}


@lru_cache
def nodes() -> dict[str, dict]:
    data = json.loads((DATA_DIR / "nodes.json").read_text(encoding="utf-8"))
    return {n["code"]: n for n in data["nodes"]}
