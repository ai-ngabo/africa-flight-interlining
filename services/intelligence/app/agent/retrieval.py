"""Retrieval over the policy knowledge base (visa protocols, self-transfer, baggage, pricing).

Uses a Chroma vector server when CHROMA_URL is set (free, self-hosted) and the
`chromadb-client` package is installed; otherwise an in-process BM25 index.
"""
from __future__ import annotations

import logging
import math
import re
from collections import Counter
from dataclasses import dataclass

from ..config import CHROMA_URL, KNOWLEDGE_DIR, carriers

log = logging.getLogger(__name__)
TOKEN = re.compile(r"[a-z0-9]+")
STOP = set("the a an of to and or in on for is are be by with as at from that this it can may must not".split())


@dataclass
class Chunk:
    id: str
    source: str
    title: str
    text: str


def tokenize(s: str) -> list[str]:
    return [t for t in TOKEN.findall(s.lower()) if t not in STOP]


def load_chunks() -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(KNOWLEDGE_DIR.glob("*.md")):
        current, buf = path.stem, []
        n = 0

        def flush():
            nonlocal n
            body = "\n".join(buf).strip()
            if body:
                chunks.append(Chunk(f"{path.stem}#{n}", path.name, current, body))
                n += 1

        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("## ") or line.startswith("### "):
                flush()
                current, buf = line.lstrip("# ").strip(), []
            else:
                buf.append(line)
        flush()
    # Baggage policies are generated from structured carrier data so they never drift from it.
    for c in carriers().values():
        bags = f"{c['checkedBags']} x {c['checkedBagKg']} kg checked" if c["checkedBags"] else "no free checked bag (paid add-on)"
        chunks.append(Chunk(f"baggage#{c['code']}", "carriers.json", f"Baggage policy {c['name']} ({c['code']})",
                            f"{c['name']} ({c['code']}, {c['mode']}) economy allowance (sample data): {bags}; cabin {c['cabinKg']} kg. Baggage is not through-checked on self-transfers."))
    return chunks


class BM25:
    def __init__(self, chunks: list[Chunk], k1: float = 1.4, b: float = 0.75):
        self.chunks, self.k1, self.b = chunks, k1, b
        self.docs = [tokenize(c.title + " " + c.text) for c in chunks]
        self.avg = sum(map(len, self.docs)) / max(1, len(self.docs))
        df = Counter(t for d in self.docs for t in set(d))
        N = len(self.docs)
        self.idf = {t: math.log(1 + (N - n + 0.5) / (n + 0.5)) for t, n in df.items()}
        self.tf = [Counter(d) for d in self.docs]

    def search(self, query: str, k: int = 3) -> list[tuple[Chunk, float]]:
        q = tokenize(query)
        scores = []
        for i, tf in enumerate(self.tf):
            s = 0.0
            for t in q:
                if t in tf:
                    f = tf[t]
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * len(self.docs[i]) / self.avg))
            scores.append((self.chunks[i], s))
        return [x for x in sorted(scores, key=lambda x: -x[1])[:k] if x[1] > 0]


class Retriever:
    def __init__(self):
        self.chunks = load_chunks()
        self.bm25 = BM25(self.chunks)
        self.kind = "bm25"
        self.collection = None
        if CHROMA_URL:
            try:
                import chromadb  # type: ignore
                from urllib.parse import urlparse

                u = urlparse(CHROMA_URL)
                client = chromadb.HttpClient(host=u.hostname, port=u.port or 8000)
                self.collection = client.get_or_create_collection("policy_docs")
                self.collection.upsert(ids=[c.id for c in self.chunks], documents=[c.text for c in self.chunks],
                                       metadatas=[{"source": c.source, "title": c.title} for c in self.chunks])
                self.kind = "chroma"
            except Exception as e:  # pragma: no cover - optional infra
                log.warning("Chroma unavailable (%s); using BM25", e)

    def search(self, query: str, k: int = 3) -> list[dict]:
        if self.collection is not None:
            try:
                r = self.collection.query(query_texts=[query], n_results=k)
                return [{"id": i, "title": m["title"], "source": m["source"], "text": d}
                        for i, m, d in zip(r["ids"][0], r["metadatas"][0], r["documents"][0])]
            except Exception as e:  # pragma: no cover
                log.warning("Chroma query failed (%s); using BM25", e)
        return [{"id": c.id, "title": c.title, "source": c.source, "text": c.text, "score": round(s, 3)} for c, s in self.bm25.search(query, k)]
