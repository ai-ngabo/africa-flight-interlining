"""Virtual Interlining & Risk Engine + LLM Constraint & Policy Agent (FastAPI)."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from fastapi import FastAPI, Query
from pydantic import BaseModel, Field

from .agent.agent import ask
from .agent.retrieval import Retriever
from .config import OLLAMA_MODEL, OLLAMA_URL, visa_rules
from .risk.model import RiskModel
from .risk.scoring import score_itineraries
from .visa.rules import entry_requirement, itinerary_flags

logging.basicConfig(level=logging.INFO)
state: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["model"] = RiskModel.load_or_train()
    state["retriever"] = Retriever()
    yield


app = FastAPI(title="Interlining Risk & Policy Intelligence", version="0.1.0", lifespan=lifespan)


class LegIn(BaseModel):
    carrier: str
    mode: Literal["flight", "bus"]
    from_: str = Field(alias="from")
    to: str
    fromCountry: str
    toCountry: str
    durationMin: float
    fareUsd: float
    carrierOtp: float = Field(ge=0, le=1)
    delayStdMin: float
    frequencyPerWeek: float


class ConnectionIn(BaseModel):
    arriveAt: str
    departFrom: str
    country: str
    type: Literal["protected", "self_transfer", "ground_transfer"]
    layoverMin: float
    requiredMin: float
    bufferMin: float
    groundTransferMin: float = 0
    terminalComplexity: float
    weatherRisk: bool
    requiresImmigration: bool
    requiresBagRecheck: bool
    overnight: bool


class ItineraryIn(BaseModel):
    id: str
    originCountry: str
    destinationCountry: str
    legs: list[LegIn] = Field(min_length=1, max_length=6)
    connections: list[ConnectionIn]


class AssessRequest(BaseModel):
    nationality: str | None = Field(default=None, min_length=2, max_length=2)
    month: int | None = Field(default=None, ge=1, le=12)
    itineraries: list[ItineraryIn] = Field(max_length=60)


class AgentRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    nationality: str | None = Field(default=None, min_length=2, max_length=2)
    itinerary: dict | None = None


@app.get("/health")
async def health():
    llm = "unreachable"
    try:
        # Keep well under the gateway's 2s health timeout (Windows retries refused connects for ~2s).
        async with httpx.AsyncClient(timeout=0.5) as c:
            r = await c.get(f"{OLLAMA_URL}/api/tags")
            names = [m["name"] for m in r.json().get("models", [])]
            llm = "ready" if any(n.startswith(OLLAMA_MODEL.split(":")[0]) for n in names) else f"model {OLLAMA_MODEL} not pulled"
    except Exception:
        pass
    return {"status": "ok", "riskModel": state["model"].meta, "retrieval": state["retriever"].kind, "llm": llm,
            "visaRules": {"lastReviewed": visa_rules()["lastReviewed"], "status": visa_rules()["reviewStatus"]}}


@app.post("/v1/assess")
async def assess(req: AssessRequest):
    its = [i.model_dump(by_alias=True) for i in req.itineraries]
    scores = score_itineraries(state["model"], its)
    results = []
    nat = req.nationality.upper() if req.nationality else None
    for it in its:
        status, flags = itinerary_flags(nat, it)
        results.append({"id": it["id"], **scores[it["id"]], "travelDocStatus": status, "visaFlags": flags})
    return {"results": results, "model": state["model"].meta.get("engine")}


@app.get("/v1/visa")
async def visa(nationality: str = Query(min_length=2, max_length=2), destination: str = Query(min_length=2, max_length=2)):
    return {"nationality": nationality.upper(), "destination": destination.upper(), **entry_requirement(nationality, destination),
            "disclaimer": visa_rules()["_disclaimer"]}


@app.post("/v1/agent/ask")
async def agent_ask(req: AgentRequest):
    return await ask(req.question, req.nationality.upper() if req.nationality else None, req.itinerary, state["retriever"])


@app.get("/v1/model")
async def model_info():
    return state["model"].meta
