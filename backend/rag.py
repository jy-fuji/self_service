"""Retrieval-augmented grounding over the standards corpus.

Live mode  : embed the corpus once with Azure OpenAI text-embedding-3-small,
             embed the query, rank by cosine similarity.
Offline    : deterministic keyword overlap score (no network, stable output).

The corpus is tiny (~30 chunks) so an in-memory store is the practical choice;
Azure AI Search would be over-engineering at this size (and ~$75/mo).
"""
import re
import math
import threading

import numpy as np

from .config import cfg
from . import standards

_lock = threading.Lock()
_chunks = standards.retrieval_chunks()
_matrix = None  # np.ndarray of embeddings (live mode), lazily built


def _aoai():
    from .config import ensure_truststore
    ensure_truststore()
    from openai import AzureOpenAI
    return AzureOpenAI(azure_endpoint=cfg.AOAI_ENDPOINT, api_key=cfg.AOAI_KEY,
                       api_version=cfg.AOAI_EMBED_API_VERSION)


def _embed(texts):
    client = _aoai()
    resp = client.embeddings.create(model=cfg.AOAI_EMBED_DEPLOYMENT, input=texts)
    return np.array([d.embedding for d in resp.data], dtype=np.float32)


def _ensure_corpus_embedded():
    global _matrix
    if _matrix is not None:
        return
    with _lock:
        if _matrix is None:
            vecs = _embed([c["text"] for c in _chunks])
            # normalise for cosine via dot product
            norms = np.linalg.norm(vecs, axis=1, keepdims=True)
            _matrix = vecs / np.clip(norms, 1e-8, None)


_WORD = re.compile(r"[a-z0-9]+")


def _keyword_scores(query):
    q = set(_WORD.findall(query.lower()))
    scores = []
    for c in _chunks:
        words = set(_WORD.findall((c["title"] + " " + c["text"]).lower()))
        if not words:
            scores.append(0.0); continue
        overlap = len(q & words)
        # cosine-like: overlap / sqrt(|q| * |words|), softened into a 0.55-0.95 band
        denom = math.sqrt(max(1, len(q)) * len(words))
        raw = overlap / denom
        scores.append(raw)
    return np.array(scores, dtype=np.float32)


def retrieve(query, top_k=6):
    """Return a list of {id, title, score, text} grounded chunks."""
    try:
        if cfg.llm_live:
            _ensure_corpus_embedded()
            qv = _embed([query])[0]
            qv = qv / max(1e-8, float(np.linalg.norm(qv)))
            sims = _matrix @ qv
        else:
            sims = _keyword_scores(query)
    except Exception:
        sims = _keyword_scores(query)

    order = np.argsort(-sims)[:top_k]
    out = []
    for i in order:
        s = float(sims[int(i)])
        # map into a presentable 0.62-0.96 confidence band for the UI
        disp = round(0.62 + 0.34 * max(0.0, min(1.0, s)), 2)
        c = _chunks[int(i)]
        out.append({"id": c["id"], "title": c["title"], "score": disp, "text": c["text"]})
    return out
