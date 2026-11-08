import asyncio

import pytest
from fastapi.testclient import TestClient

from app.agent.agent import _fallback
from app.agent.retrieval import Retriever
from app.main import app
from app.risk.model import RiskModel
from app.risk.scoring import connection_features
from app.visa.rules import entry_requirement, itinerary_flags


def conn(type_="self_transfer", buffer=60, required=150, country="KE", at="NBO", **kw):
    return {"arriveAt": at, "departFrom": at, "country": country, "type": type_, "layoverMin": required + buffer,
            "requiredMin": required, "bufferMin": buffer, "groundTransferMin": 0, "terminalComplexity": 4,
            "weatherRisk": False, "requiresImmigration": type_ != "protected", "requiresBagRecheck": type_ != "protected",
            "overnight": False, **kw}


def leg(frm="KGL", to="NBO", fc="RW", tc="KE", mode="flight", otp=0.8, fare=200):
    return {"carrier": "WB", "mode": mode, "from": frm, "to": to, "fromCountry": fc, "toCountry": tc, "durationMin": 75,
            "fareUsd": fare, "carrierOtp": otp, "delayStdMin": 12 + (1 - otp) * 110, "frequencyPerWeek": 14}


# ---------------------------------------------------------------- visa rules
def test_ecowas_free_movement():
    assert entry_requirement("GH", "NG")["requirement"] == "visa_free"


def test_rwanda_open_to_africans():
    r = entry_requirement("NG", "RW")
    assert r["requirement"] == "visa_free" and r["maxStayDays"] == 30


def test_kenya_exception_list():
    assert entry_requirement("NG", "KE")["requirement"] == "visa_free"
    assert entry_requirement("SO", "KE")["requirement"] == "eta"


def test_nigeria_needs_evisa_for_non_ecowas():
    assert entry_requirement("RW", "NG")["requirement"] == "evisa"


def test_self_transfer_requires_hub_entry():
    it = {"legs": [leg(), leg("NBO", "LOS", "KE", "NG")], "connections": [conn(country="KE")]}
    status, flags = itinerary_flags("RW", it)
    reasons = {(f["country"], f["reason"]) for f in flags}
    assert ("KE", "self_transfer_entry") in reasons and ("NG", "destination") in reasons
    assert status == "action_needed"  # NG e-visa for a Rwandan


def test_protected_connection_is_airside():
    it = {"legs": [leg("KGL", "ADD", "RW", "ET"), leg("ADD", "LOS", "ET", "NG")], "connections": [conn("protected", country="ET", at="ADD")]}
    _, flags = itinerary_flags("GH", it)
    assert flags[0]["reason"] == "airside_transit" and flags[0]["severity"] == 0


def test_bus_border_crossings():
    legs = [leg("LOS-BUS", "COO-BUS", "NG", "BJ", "bus"), leg("COO-BUS", "LFW-BUS", "BJ", "TG", "bus"), leg("LFW-BUS", "ACC-BUS", "TG", "GH", "bus")]
    it = {"legs": legs, "connections": [conn(country="BJ", at="COO-BUS"), conn(country="TG", at="LFW-BUS")]}
    status, flags = itinerary_flags("NG", it)
    assert [f["country"] for f in flags] == ["BJ", "TG", "GH"]
    assert status == "ok"  # ECOWAS + Benin open to Africans


# ---------------------------------------------------------------- risk model
@pytest.fixture(scope="module")
def model():
    return RiskModel.load_or_train()


def test_more_buffer_less_risk(model):
    tight = connection_features(conn(buffer=0), leg(otp=0.65))
    loose = connection_features(conn(buffer=240), leg(otp=0.65))
    p_tight, p_loose = model.predict([tight, loose])
    assert p_tight > p_loose
    assert 0 <= p_loose <= 1


def test_punctual_carrier_less_risk(model):
    late = connection_features(conn(buffer=30), leg(otp=0.6))
    punctual = connection_features(conn(buffer=30), leg(otp=0.92))
    a, b = model.predict([late, punctual])
    assert a > b


# ---------------------------------------------------------------- API
def test_assess_endpoint():
    with TestClient(app) as client:
        body = {"nationality": "RW", "itineraries": [{
            "id": "x1", "originCountry": "RW", "destinationCountry": "NG",
            "legs": [leg(), leg("NBO", "LOS", "KE", "NG", fare=500)], "connections": [conn(buffer=10)]}]}
        r = client.post("/v1/assess", json=body)
        assert r.status_code == 200
        res = r.json()["results"][0]
        assert 0 < res["riskScore"] < 1
        assert res["protectionPremiumUsd"] >= 3
        assert res["travelDocStatus"] == "action_needed"


def test_agent_fallback_answers_visa_question():
    out = _fallback("I am Rwandan, do I need a visa for Nigeria?", None, Retriever())
    assert out["mode"] == "fallback"
    assert any(c["tool"] == "lookup_entry_requirement" and c["result"]["requirement"] == "evisa" for c in out["toolCalls"])


def test_retrieval_finds_ecowas():
    hits = Retriever().search("ECOWAS free movement 90 days", 3)
    assert any("ECOWAS" in h["title"] or "ECOWAS" in h["text"] for h in hits)
