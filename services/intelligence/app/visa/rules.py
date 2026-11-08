"""Deterministic entry-requirement engine.

Visa decisions are made by explicit, auditable rules — never by the LLM. The
LLM agent only *explains* these results and retrieves supporting documents.
"""
from __future__ import annotations

from ..config import visa_rules


def _applies(applies_to: dict, nationality: str, rules: dict) -> bool:
    if applies_to.get("all"):
        return True
    if applies_to.get("african"):
        return nationality in rules["africanCountries"] and nationality not in applies_to.get("except", [])
    if "bloc" in applies_to:
        return nationality in rules["blocs"].get(applies_to["bloc"], {}).get("members", [])
    if "countries" in applies_to:
        return nationality in applies_to["countries"]
    return False


def entry_requirement(nationality: str, destination: str) -> dict:
    rules = visa_rules()
    sev = rules["requirementSeverity"]
    nationality, destination = nationality.upper(), destination.upper()
    if nationality == destination:
        return {"requirement": "none", "severity": 0, "confidence": "high", "note": "Citizen of destination country."}
    dest = rules["destinations"].get(destination)
    if dest is None:
        return {"requirement": "check_required", "severity": sev["check_required"], "confidence": "low", "note": "No rule on file for this destination."}
    for rule in dest["rules"]:
        if _applies(rule["appliesTo"], nationality, rules):
            matched = rule
            break
    else:
        matched = dest["default"]
    out = {
        "requirement": matched["requirement"],
        "severity": sev[matched["requirement"]],
        "confidence": matched.get("confidence", "low"),
    }
    if "maxStayDays" in matched:
        out["maxStayDays"] = matched["maxStayDays"]
    note = matched.get("note")
    bloc = matched.get("appliesTo", {}).get("bloc")
    if bloc and not note:
        note = rules["blocs"][bloc]["note"]
    if note:
        out["note"] = note
    return out


def airside_transit(hub: str) -> dict:
    t = visa_rules()["airsideTransit"].get(hub)
    if t and t["possible"]:
        return {"requirement": "airside_transit", "severity": 0, "confidence": t["confidence"], "note": t.get("note", "Airside transit on a protected connection is usually possible without a visa.")}
    return {"requirement": "check_required", "severity": 2, "confidence": "low", "note": "Transit rules for this airport are not on file."}


def itinerary_flags(nationality: str | None, it: dict) -> tuple[str, list[dict]]:
    """Returns (travelDocStatus, flags). Self-transfers require *entry* to the hub country."""
    if not nationality:
        return "unknown", []
    flags: list[dict] = []
    seen: set[str] = set()
    legs, conns = it["legs"], it["connections"]

    def add(country: str, at: str, reason: str, req: dict):
        if country == nationality.upper() or country in seen:
            return
        seen.add(country)
        flags.append({"country": country, "at": at, "reason": reason, **req})

    for i, leg in enumerate(legs):
        if i > 0:
            c = conns[i - 1]
            if c["type"] == "protected":
                if c["country"] != nationality.upper() and c["country"] not in seen:
                    flags.append({"country": c["country"], "at": c["arriveAt"], "reason": "airside_transit", **airside_transit(c["arriveAt"])})
            else:
                add(c["country"], c["arriveAt"], "self_transfer_entry", entry_requirement(nationality, c["country"]))
        last = i == len(legs) - 1
        if last:
            add(leg["toCountry"], leg["to"], "destination", entry_requirement(nationality, leg["toCountry"]))
        elif leg["mode"] == "bus" and leg["fromCountry"] != leg["toCountry"]:
            add(leg["toCountry"], leg["to"], "land_border", entry_requirement(nationality, leg["toCountry"]))

    worst = max((f["severity"] for f in flags), default=0)
    status = "ok" if worst == 0 else "visa_required" if worst >= 3 else "action_needed"
    return status, flags
