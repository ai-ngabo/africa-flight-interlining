"""SelfTransferRiskScore model (gradient-boosted trees, XGBoost)."""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field

import numpy as np

from ..config import MODEL_DIR
from .simulator import FEATURES, MONOTONE, simulate

MODEL_FILE = MODEL_DIR / "risk_xgb.json"
META_FILE = MODEL_DIR / "risk_xgb.meta.json"

try:  # xgboost is optional at runtime: the service degrades to a logistic heuristic
    import xgboost as xgb
except Exception:  # pragma: no cover
    xgb = None


def train(n: int = 60_000, seed: int = 7) -> dict:
    if xgb is None:
        raise RuntimeError("xgboost is not installed")
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import train_test_split

    X, y = simulate(n, seed)
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=seed, stratify=y)
    clf = xgb.XGBClassifier(
        n_estimators=250,
        max_depth=5,
        learning_rate=0.08,
        subsample=0.9,
        colsample_bytree=0.9,
        eval_metric="logloss",
        monotone_constraints="(" + ",".join(str(MONOTONE[f]) for f in FEATURES) + ")",
        n_jobs=2,
    )
    clf.fit(X_tr, y_tr)
    auc = float(roc_auc_score(y_te, clf.predict_proba(X_te)[:, 1]))
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    clf.save_model(MODEL_FILE)
    meta = {
        "features": FEATURES,
        "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rows": n,
        "positiveRate": float(y.mean()),
        "holdoutAuc": round(auc, 4),
        "synthetic": True,
        "note": "Trained on simulated outcomes; retrain on real punctuality data before production.",
    }
    META_FILE.write_text(json.dumps(meta, indent=2))
    return meta


@dataclass
class RiskModel:
    booster: object | None = None
    meta: dict = field(default_factory=dict)

    @classmethod
    def load_or_train(cls) -> "RiskModel":
        if xgb is None:
            return cls(None, {"engine": "heuristic", "reason": "xgboost not installed"})
        if not MODEL_FILE.exists():
            train()
        clf = xgb.XGBClassifier()
        clf.load_model(MODEL_FILE)
        meta = json.loads(META_FILE.read_text()) if META_FILE.exists() else {}
        return cls(clf, {"engine": "xgboost", **meta})

    def predict(self, rows: list[list[float]]) -> list[float]:
        if not rows:
            return []
        if self.booster is not None:
            return [float(p) for p in self.booster.predict_proba(np.asarray(rows, dtype=float))[:, 1]]
        return [_heuristic(r) for r in rows]


def _heuristic(r: list[float]) -> float:
    buffer, _req, otp, std, weather, cx, *_ = r
    x = -buffer / 25 + (1 - otp) * 3 + std / 60 + cx * 0.15 + weather * 0.4 - 1.5
    return 1 / (1 + math.exp(-x))
