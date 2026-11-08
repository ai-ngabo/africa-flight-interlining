"""LLM Constraint & Policy Agent (function-calling loop on a free local model via Ollama).

The LLM never decides entry requirements itself: it must call
`lookup_entry_requirement`, which runs the deterministic rule engine. If Ollama
is not running, a deterministic fallback answers from the same tools.
"""
from __future__ import annotations

import json
import re

import httpx

from ..config import OLLAMA_MODEL, OLLAMA_URL, carriers, nodes, visa_rules
from ..visa.rules import entry_requirement
from .retrieval import Retriever

SYSTEM_PROMPT = """You are the travel-policy assistant of a Pan-African flight and coach aggregator.
Rules:
- ALWAYS call lookup_entry_requirement for any visa/entry question. Never guess entry rules.
- Use search_policy_documents for protocols (ECOWAS, EAC, AU), self-transfer and protection terms.
- Use get_baggage_policy for baggage questions.
- On a self-transfer the traveller must ENTER the connecting country (immigration + bag re-check).
- State the confidence level returned by tools and advise verifying with official sources.
- Answer in under 120 words, plain language, suitable for SMS/low bandwidth."""

TOOLS = [
    {"type": "function", "function": {
        "name": "lookup_entry_requirement",
        "description": "Entry requirement (visa_free, eta, evisa, visa_on_arrival, visa_required) for a passport nationality entering a country.",
        "parameters": {"type": "object", "properties": {
            "nationality": {"type": "string", "description": "ISO 3166-1 alpha-2 code of the passport, e.g. RW"},
            "destination_country": {"type": "string", "description": "ISO 3166-1 alpha-2 code of the country entered, e.g. NG"}},
            "required": ["nationality", "destination_country"]}}},
    {"type": "function", "function": {
        "name": "search_policy_documents",
        "description": "Search the knowledge base of African free-movement protocols, self-transfer rules, protection terms and fair pricing.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "get_baggage_policy",
        "description": "Baggage allowance for a carrier code (e.g. WB, ET, KQ, P4).",
        "parameters": {"type": "object", "properties": {"carrier_code": {"type": "string"}}, "required": ["carrier_code"]}}},
]

# Country-name lookup for the deterministic fallback (and to help small models).
COUNTRY_NAMES = {
    "rwanda": "RW", "uganda": "UG", "kenya": "KE", "tanzania": "TZ", "ethiopia": "ET", "burundi": "BI", "congo": "CD", "drc": "CD",
    "south africa": "ZA", "nigeria": "NG", "ghana": "GH", "ivory coast": "CI", "cote d'ivoire": "CI", "côte d'ivoire": "CI",
    "senegal": "SN", "togo": "TG", "benin": "BJ", "cameroon": "CM", "morocco": "MA", "egypt": "EG", "zambia": "ZM",
    "zimbabwe": "ZW", "malawi": "MW", "mozambique": "MZ", "namibia": "NA", "botswana": "BW", "mauritius": "MU",
    "seychelles": "SC", "somalia": "SO", "libya": "LY", "tunisia": "TN", "mali": "ML", "niger": "NE", "gabon": "GA",
}
CITY_TO_COUNTRY = {n["metro"].lower(): n["country"] for n in nodes().values()}
DEMONYMS = {"rwandan": "RW", "ugandan": "UG", "kenyan": "KE", "tanzanian": "TZ", "ethiopian": "ET", "nigerian": "NG", "ghanaian": "GH",
            "south african": "ZA", "senegalese": "SN", "cameroonian": "CM", "egyptian": "EG", "moroccan": "MA", "zambian": "ZM",
            "zimbabwean": "ZW", "togolese": "TG", "beninese": "BJ", "ivorian": "CI", "burundian": "BI", "congolese": "CD"}


def _tool(name: str, args: dict, retriever: Retriever) -> dict:
    if name == "lookup_entry_requirement":
        nat, dest = str(args.get("nationality", "")).upper()[:2], str(args.get("destination_country", "")).upper()[:2]
        return {"nationality": nat, "destination": dest, **entry_requirement(nat, dest), "disclaimer": visa_rules()["_disclaimer"]}
    if name == "search_policy_documents":
        return {"results": [{k: r[k] for k in ("title", "source", "text")} for r in retriever.search(str(args.get("query", "")), 3)]}
    if name == "get_baggage_policy":
        c = carriers().get(str(args.get("carrier_code", "")).upper())
        return c or {"error": "unknown carrier"}
    return {"error": f"unknown tool {name}"}


def _countries_in(text: str) -> list[str]:
    t = text.lower()
    found = []
    for name, code in {**COUNTRY_NAMES, **CITY_TO_COUNTRY}.items():
        for m in re.finditer(r"\b" + re.escape(name) + r"\b", t):
            found.append((m.start(), code))
    seen, out = set(), []
    for _, c in sorted(found):
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _fallback(question: str, nationality: str | None, retriever: Retriever) -> dict:
    calls, lines = [], []
    q = question.lower()
    nat = nationality
    if not nat:
        for d, code in DEMONYMS.items():
            if re.search(r"\b" + d + r"\b", q):
                nat = code
                break
    countries = [c for c in _countries_in(question) if c != nat]
    if nat and countries:
        for dest in countries[:3]:
            r = _tool("lookup_entry_requirement", {"nationality": nat, "destination_country": dest}, retriever)
            calls.append({"tool": "lookup_entry_requirement", "args": {"nationality": nat, "destination_country": dest}, "result": r})
            stay = f" up to {r['maxStayDays']} days" if r.get("maxStayDays") else ""
            lines.append(f"{nat} passport → {dest}: {r['requirement'].replace('_', ' ')}{stay} (confidence: {r['confidence']}).{(' ' + r['note']) if r.get('note') else ''}")
    elif countries and not nat:
        lines.append("Tell me your passport nationality to check entry requirements.")
    # Carrier codes are matched case-sensitively ("AT" the airline, not "at" the word).
    codes = [c for c in carriers() if re.search(r"\b" + re.escape(c) + r"\b", question) or carriers()[c]["name"].lower() in q]
    if "bag" in q or "luggage" in q:
        for code in codes[:3]:
            c = carriers()[code]
            calls.append({"tool": "get_baggage_policy", "args": {"carrier_code": code}, "result": c})
            lines.append(f"{c['name']}: {c['checkedBags']}x{c['checkedBagKg']}kg checked, {c['cabinKg']}kg cabin (sample data).")
    docs = retriever.search(question, 2)
    calls.append({"tool": "search_policy_documents", "args": {"query": question}, "result": {"results": docs}})
    if docs and not lines:
        lines.append(docs[0]["text"][:400].strip())
    if any(c["tool"] == "lookup_entry_requirement" for c in calls):
        lines.append("Always verify with the official immigration portal before travel.")
    elif any(c["tool"] == "get_baggage_policy" for c in calls):
        lines.append("Allowances vary by fare type, so confirm with the carrier before you pack.")
    return {"answer": " ".join(lines), "mode": "fallback", "toolCalls": calls, "sources": sorted({d["source"] for d in docs})}


async def ask(question: str, nationality: str | None, itinerary: dict | None, retriever: Retriever) -> dict:
    user = question
    if nationality:
        user += f"\n(Passport nationality: {nationality})"
    if itinerary:
        user += "\nItinerary: " + json.dumps(itinerary)[:2000]
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]
    calls: list[dict] = []
    sources: set[str] = set()
    try:
        # Fail fast to the deterministic fallback when Ollama isn't running; allow slow CPU generation when it is.
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=1.0)) as client:
            for _ in range(5):
                r = await client.post(f"{OLLAMA_URL}/api/chat", json={
                    "model": OLLAMA_MODEL, "messages": messages, "tools": TOOLS, "stream": False, "options": {"temperature": 0.1}})
                r.raise_for_status()
                msg = r.json()["message"]
                messages.append(msg)
                tool_calls = msg.get("tool_calls") or []
                if not tool_calls:
                    return {"answer": msg.get("content", "").strip(), "mode": "llm", "model": OLLAMA_MODEL, "toolCalls": calls, "sources": sorted(sources)}
                for tc in tool_calls:
                    fn = tc["function"]
                    args = fn.get("arguments") or {}
                    if isinstance(args, str):
                        args = json.loads(args or "{}")
                    result = _tool(fn["name"], args, retriever)
                    if fn["name"] == "search_policy_documents":
                        sources.update(x["source"] for x in result["results"])
                    calls.append({"tool": fn["name"], "args": args, "result": result})
                    messages.append({"role": "tool", "tool_name": fn["name"], "content": json.dumps(result)[:4000]})
        return {**_fallback(question, nationality, retriever), "note": "LLM did not finish within the tool-call budget"}
    except (httpx.HTTPError, KeyError, ValueError):
        return _fallback(question, nationality, retriever)
