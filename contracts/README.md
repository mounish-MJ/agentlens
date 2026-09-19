# AgentLens Shared Contracts & DynamoDB Key Strategy

This directory contains the canonical type contracts, API interface definitions, and data schema specifications for AgentLens.

---

## Canonical Domain Entities (Phase 3, 4 & 5)

| Entity | Primary ID | Purpose |
|---|---|---|
| **Run** | `run_id` (`run_<uuid>`) | Agent execution lifecycle, input prompt, status, execution metrics, and metadata |
| **TelemetryEvent** | `event_id` (`evt_<uuid>`) | Individual execution events: tool calls, model invocations, state changes, logs, metrics |
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
| **Run (Metadata)** | `RUN#<run_id>` | `METADATA` | Full record of agent execution run | `GetItem(pk=RUN#<id>, sk=METADATA)` (O(1)) |
| **Runs (Timeline)** | `RUNS` | `RUN#<created_at>#<run_id>` | Global chronological runs timeline | `Query(pk=RUNS, ScanIndexForward=false)` (O(k)) |
| **Run Telemetry Events** | `RUN#<run_id>` | `EVENT#<timestamp>#<event_id>` | Chronological telemetry events collection | `Query(pk=RUN#<id>, begins_with(sk, 'EVENT#'))` (O(k)) |
| **Incident (Primary)** | `INCIDENT#<incident_id>` | `METADATA` | Direct lookup by incident identifier | `GetItem(pk=INCIDENT#<id>, sk=METADATA)` (O(1)) |
| **Incidents (Timeline)** | `INCIDENTS` | `INCIDENT#<created_at>#<id>` | Global chronological incident timeline | `Query(pk=INCIDENTS, ScanIndexForward=false)` (O(k)) |
| **RegressionTest** | `TEST#<test_id>` | `METADATA` | Regression test definition | `GetItem(pk=TEST#<id>, sk=METADATA)` (O(1)) |
| **Evaluation** | `EVAL#<evaluation_id>` | `METADATA` | Scorecard evaluation record | `GetItem(pk=EVAL#<id>, sk=METADATA)` (O(1)) |
| **ReplayRecord** | `REPLAY#<replay_id>` | `METADATA` | Recorded environment state snapshot | `GetItem(pk=REPLAY#<id>, sk=METADATA)` (O(1)) |

### Design Rationale
1. **Zero Table Scans**: All lookups are direct point-queries (`O(1)`). Global run and incident listings query fixed partition keys (`pk = RUNS` and `pk = INCIDENTS`) with `ScanIndexForward = false` in `O(k)` (newest first).
2. **Zero Secondary Indexes (GSI)**: Avoids extra capacity or GSI replication lag during the hackathon, keeping billing strictly on-demand.
3. **Dual-Write Synchronization**: `createRun` writes both the primary metadata item (`pk = RUN#<run_id>, sk = METADATA`) and the timeline item (`pk = RUNS, sk = RUN#<created_at>#<run_id>`). `updateRunTelemetry` keeps both items synchronized when status, metrics, or error/result are updated.
4. **Partition Isolation & Item Collection**: Co-locating telemetry events under `RUN#<run_id>` partition alongside `sk=METADATA` organizes all run data in a single partition for clean query patterns and cascading cleanup.
5. **Unique Event ID Strategy**: Telemetry events use generated unique IDs (`evt_<randomUUID>`) to guarantee collision-free writes across concurrent worker/agent invocations.
6. **Canonical Event Validation**: Strictly validates incoming event types (`tool_call`, `model_invocation`, `state_change`, `log`, `metric`). Rejects arbitrary or malformed types with HTTP 400 (`VALIDATION_ERROR`).

---

## API Endpoints (Phase 3, 4 & 5)

- `GET /health` — Foundation health probe returning runtime status, region, and table name.
- `POST /runs` — Validates input, creates a new Run, persists to DynamoDB (both primary and timeline items), and returns HTTP 201.
- `GET /runs?limit={n}` — Lists chronological Runs (newest first) with validated limit (default: 50, max: 100).
- `GET /runs/{run_id}` — Retrieves Run by ID from DynamoDB with status, metrics, and `events_count`.
- `POST /runs/{run_id}/telemetry` — Ingests telemetry events, updates Run status, result, error, and metrics across both primary and timeline items.
- `GET /runs/{run_id}/telemetry?limit={n}` — Retrieves chronological telemetry events for a Run (oldest to newest).
- `GET /incidents` — Lists chronological incidents from DynamoDB (returns empty array `[]` when none exist; never fake data).
- `GET /incidents/{incident_id}` — Retrieves Incident by ID from DynamoDB (returns HTTP 404 if missing).
