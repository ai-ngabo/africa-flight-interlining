# Free resources used (and how to stay at $0)

Everything in this repository runs on a laptop at **zero cost** with Node.js 20 and Python 3.11–3.13.
The optional infrastructure (Docker Compose) is also free, open-source software.

> Free tiers of hosted services change often. Items marked *(verify)* were accurate to the best
> of our knowledge when written — check the provider's current terms before relying on them.

## Mapping: architecture document → free implementation

| Architecture component | What we use | Cost / licence | Fallback when not running |
|---|---|---|---|
| API Gateway & Edge LB | Fastify + `@fastify/rate-limit`, `@fastify/compress` | MIT | — |
| IAM & Digital Identity | Phone OTP + JWT (`jose`) | MIT | OTP shown on screen in dev |
| Core Search & Routing | Custom time-dependent graph search (TypeScript) | Own code | — |
| African Routes Graph | **Neo4j Community 5** | GPLv3, free | Seed files in `data/` |
| Real-time fares cache | **Redis 7** (or Valkey, BSD) | Free self-hosted | In-process TTL cache |
| Virtual Interlining & Risk Engine | FastAPI + **XGBoost** | Apache-2.0 | Logistic heuristic |
| LLM Constraint & Policy Agent | **Ollama** + Llama 3.1 8B / Mistral 7B | Free local inference (Llama community licence / Apache-2.0) | Deterministic tool-based answers |
| Visa & baggage vector DB | **Chroma** (Milvus also free) | Apache-2.0 | Built-in BM25 retrieval |
| Booking & PNR + ledger | **PostgreSQL 16** | PostgreSQL licence | In-memory store |
| PAPSS gateway | Simulator (no public sandbox) | — | Simulator |
| Mobile money | MTN MoMo sandbox, Safaricom Daraja sandbox | Free developer accounts | Simulator |
| USSD / SMS layer | Africa's Talking format (free sandbox + simulator) | Free sandbox | Callable locally via curl |
| Frontend | Next.js 14 static-export PWA | MIT | — |
| FX reference rates | open.er-api.com (no key) | Free | Seed rates |

## Data sources

| Need | Free option | Limits |
|---|---|---|
| Airports (codes, coordinates) | [OurAirports](https://ourairports.com/data/) | Public domain |
| Historical route network | [OpenFlights routes](https://openflights.org/data) | ODbL; last updated 2014, so treat it as a starting point only |
| Flight history / punctuality (to train the risk model on real data) | [OpenSky Network](https://opensky-network.org) | Free for research/non-commercial; account needed for historical data |
| Live schedules / status | AviationStack free plan; AeroDataBox via RapidAPI basic plan | Small monthly quotas *(verify)* |
| Bookable fares (sandbox) | Duffel test mode | Test airline only; real inventory needs a commercial agreement *(verify)* |
| **Real African carrier inventory** | **None free.** Requires direct/NDC agreements with RwandAir, Ethiopian, Kenya Airways, Air Peace, ASKY, etc., or a paid GDS | This is the main non-technical dependency |
| Visa rules | Official immigration portals (free, manual); IATA Timatic is paid | Keep the human review workflow |

## Payments: sandbox sign-up (all free)

- **MTN MoMo**: https://momodeveloper.mtn.com → subscribe to *Collections* → create an API user/key
  in sandbox → set `MOMO_SUBSCRIPTION_KEY`, `MOMO_API_USER`, `MOMO_API_KEY`. The sandbox only accepts **EUR**; the adapter converts.
- **M-Pesa (Safaricom Daraja)**: https://developer.safaricom.co.ke → create an app → set
  `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY` (sandbox shortcode `174379`).
  STK callbacks need a public HTTPS URL; the adapter polls the query API instead, so local dev works.
- **Airtel Money**: Airtel Africa developer portal offers a sandbox; adapter not yet implemented (simulated).
- **Cards**: Flutterwave or Paystack test mode (free) via a hosted payment page, which keeps you out of PCI scope.
- **PAPSS**: no public developer sandbox. Access is through a participating commercial bank or central
  bank onboarding (Afreximbank-operated). The simulator models the direct local-to-local settlement.

## Free hosting options for a public demo *(verify)*

- Static PWA: Cloudflare Pages or GitHub Pages (`npm run build:web` → `web/out`).
- Backend: one always-free cloud VM (e.g. Oracle Cloud Always Free Arm instances) running `docker compose --profile app up -d`.
- Managed free tiers: Neo4j AuraDB Free, Neon/Supabase Postgres free, Upstash Redis free.
- LLM on CPU: Llama 3.1 8B Q4 runs on a machine with about 8 GB RAM through Ollama, but expect seconds per answer, not under 500 ms.
  The doc's under-500 ms target needs a GPU with vLLM, which is not free. The agent is off the search path, so search stays fast regardless.
