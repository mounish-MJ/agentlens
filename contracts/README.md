# AgentLens Shared Contracts & DynamoDB Key Strategy

This directory contains the canonical type contracts, API interface definitions, and data schema specifications for AgentLens.

---

## Canonical Domain Entities (Phase 3)

| Entity | Primary ID | Purpose |
|---|---|---|
| **Run** | `run_id` (`run_<uuid>`) | Agent execution lifecycle, input prompt, status, and metadata |
| **Incident** | `incident_id` (`inc_<uuid>`) | Detected execution failure, tool loop, token anomaly, or error |
| **RegressionTest** | `test_id` (`test_<uuid>`) | Test case derived from workflows/incidents for quality regression |
| **Evaluation** | `evaluation_id` (`eval_<uuid>`) | Scorecard / evaluation results measuring agent quality metrics |
| **ReplayRecord** | `replay_id` (`replay_<uuid>`) | Environment state snapshots for deterministic trace replay |

---

## Single-Table DynamoDB PK/SK Design

Target Table: `agentlens-data-{env}` (On-Demand billing, partition key `pk`, sort key `sk`)

### Key Mapping Matrix

| Entity / Pattern | Partition Key (`pk`) | Sort Key (`sk`) | Description | Query Access Pattern |
|---|---|---|---|---|
| **Run (Primary)** | `RUN#<run_id>` | `METADATA` | Full record of agent execution run | `GetItem(pk=RUN#<id>, sk=METADATA)` (O(1)) |
| **Incident (Primary)** | `INCIDENT#<incident_id>` | `METADATA` | Direct lookup by incident identifier | `GetItem(pk=INCIDENT#<id>, sk=METADATA)` (O(1)) |
| **Incidents (Timeline)** | `INCIDENTS` | `INCIDENT#<created_at>#<id>` | Global chronological incident timeline | `Query(pk=INCIDENTS, ScanIndexForward=false)` (O(k)) |
| **RegressionTest** | `TEST#<test_id>` | `METADATA` | Regression test definition | `GetItem(pk=TEST#<id>, sk=METADATA)` (O(1)) |
| **Evaluation** | `EVAL#<evaluation_id>` | `METADATA` | Scorecard evaluation record | `GetItem(pk=EVAL#<id>, sk=METADATA)` (O(1)) |
| **ReplayRecord** | `REPLAY#<replay_id>` | `METADATA` | Recorded environment state snapshot | `GetItem(pk=REPLAY#<id>, sk=METADATA)` (O(1)) |

### Design Rationale
1. **Zero Table Scans**: All lookups are direct `GetItem` point-queries (`O(1)`). Global incident listings query the fixed `INCIDENTS` partition key (`O(k)` newest first).
2. **Zero Secondary Indexes (GSI)**: Avoids extra provisioned capacity or GSI replication lag during the hackathon, keeping billing strictly on-demand.
3. **Partition Isolation**: Prefixing partition keys (`RUN#`, `INCIDENT#`, `TEST#`, `EVAL#`, `REPLAY#`) prevents key collisions across canonical entity types.
4. **Extensibility**: Future phases can easily add item collections (e.g. `pk=RUN#<run_id>, sk=INCIDENT#<incident_id>` or `pk=RUN#<run_id>, sk=EVAL#<evaluation_id>`) without migrating table schemas.

---

## Implemented API Endpoints (Phase 3)

- `GET /health` — Foundation health probe returning runtime status, region, and table name.
- `POST /runs` — Validates input, creates a new Run, persists to DynamoDB, and returns HTTP 201.
- `GET /runs/{run_id}` — Retrieves Run by ID from DynamoDB (returns HTTP 404 if not found).
- `GET /incidents` — Lists chronological incidents from DynamoDB (returns empty array `[]` when none exist; never fake data).
- `GET /incidents/{incident_id}` — Retrieves Incident by ID from DynamoDB (returns HTTP 404 if missing).
