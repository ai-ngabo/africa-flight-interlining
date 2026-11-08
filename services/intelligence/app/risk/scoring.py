"""Turns per-connection miss probabilities into an itinerary SelfTransferRiskScore and a protection premium."""
from __future__ import annotations

from .model import RiskModel
from .simulator import FEATURES

PROTECTED_RESIDUAL = 0.15   # carrier re-accommodates on protected connections: residual passenger risk
LOADING = 1.35              # underwriting loading on expected cost
ADMIN_USD = 2.0
MIN_PREMIUM_USD = 3.0
HOTEL_USD = 75.0
LAST_MINUTE_MULT = 1.1


def connection_features(conn: dict, inbound: dict) -> list[float]:
    f = {
        "buffer_min": conn["bufferMin"],
        "required_min": conn["requiredMin"],
        "inbound_otp": inbound["carrierOtp"],
        "inbound_delay_std": inbound["delayStdMin"],
        "weather_risk": 1.0 if conn["weatherRisk"] else 0.0,
        "terminal_complexity": conn["terminalComplexity"],
        "is_self_transfer": 1.0 if conn["type"] == "self_transfer" else 0.0,
        "is_ground_transfer": 1.0 if conn["type"] == "ground_transfer" else 0.0,
        "inbound_is_bus": 1.0 if inbound["mode"] == "bus" else 0.0,
        "inbound_duration_min": inbound["durationMin"],
    }
    return [float(f[k]) for k in FEATURES]


def label(score: float) -> str:
    return "low" if score < 0.10 else "medium" if score < 0.25 else "high"


def score_itineraries(model: RiskModel, itineraries: list[dict]) -> dict[str, dict]:
    rows, index = [], []
    for it in itineraries:
        for i, conn in enumerate(it["connections"]):
            rows.append(connection_features(conn, it["legs"][i]))
            index.append((it["id"], i))
    probs = model.predict(rows)
    per_it: dict[str, list[float]] = {it["id"]: [0.0] * len(it["connections"]) for it in itineraries}
    for (it_id, i), p in zip(index, probs):
        per_it[it_id][i] = p

    out: dict[str, dict] = {}
    for it in itineraries:
        risks = []
        expected_cost = 0.0
        for i, conn in enumerate(it["connections"]):
            p = per_it[it["id"]][i]
            if conn["type"] == "protected":
                risks.append(round(p * PROTECTED_RESIDUAL, 4))
                continue
            risks.append(round(p, 4))
            onward = it["legs"][i + 1 :]
            rebook = sum(l["fareUsd"] for l in onward) * LAST_MINUTE_MULT
            next_freq = onward[0]["frequencyPerWeek"] if onward else 7
            hotel = HOTEL_USD if next_freq < 14 or conn["overnight"] else HOTEL_USD * 0.4
            expected_cost += p * (rebook + hotel)
        survive = 1.0
        for r in risks:
            survive *= 1 - r
        score = round(1 - survive, 4)
        has_self = any(c["type"] != "protected" for c in it["connections"])
        premium = round(max(MIN_PREMIUM_USD, expected_cost * LOADING + ADMIN_USD), 2) if has_self else 0.0
        out[it["id"]] = {"riskScore": score, "riskLabel": label(score), "connectionRisks": risks, "protectionPremiumUsd": premium}
    return out
