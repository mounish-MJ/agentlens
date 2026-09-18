# AgentLens Shared Contracts & DynamoDB Key Strategy

This directory contains the canonical type contracts, API interface definitions, and data schema specifications for AgentLens.

---

## Canonical Domain Entities (Phase 3 & Phase 4)

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
| **Run Telemetry Events** | `RUN#<run_id>` | `EVENT#<timestamp>#<event_id>` | Chronological telemetry events collection | `Query(pk=RUN#<id>, begins_with(sk, 'EVENT#'))` (O(k)) |
| **Incident (Primary)** | `INCIDENT#<incident_id>` | `METADATA` | Direct lookup by incident identifier | `GetItem(pk=INCIDENT#<id>, sk=METADATA)` (O(1)) |
| **Incidents (Timeline)** | `INCIDENTS` | `INCIDENT#<created_at>#<id>` | Global chronological incident timeline | `Query(pk=INCIDENTS, ScanIndexForward=false)` (O(k)) |
| **RegressionTest** | `TEST#<test_id>` | `METADATA` | Regression test definition | `GetItem(pk=TEST#<id>, sk=METADATA)` (O(1)) |
| **Evaluation** | `EVAL#<evaluation_id>` | `METADATA` | Scorecard evaluation record | `GetItem(pk=EVAL#<id>, sk=METADATA)` (O(1)) |
| **ReplayRecord** | `REPLAY#<replay_id>` | `METADATA` | Recorded environment state snapshot | `GetItem(pk=REPLAY#<id>, sk=METADATA)` (O(1)) |

### Design Rationale
1. **Zero Table Scans**: All lookups are direct `GetItem` point-queries (`O(1)`). Chronological telemetry items query the Run's item collection using `begins_with(sk, 'EVENT#')` in `O(k)`.
2. **Zero Secondary Indexes (GSI)**: Avoids provisioned capacity or GSI replication delay during the hackathon, keeping billing strictly on-demand.
3. **Partition Isolation & Item Collection**: Co-locating telemetry events under `RUN#<run_id>` partition alongside `sk=METADATA` organizes all run data in a single partition for clean query patterns and cascading cleanup.
4. **Unique Event ID Strategy**: Telemetry events use generated unique IDs (`evt_<randomUUID>`) to guarantee collision-free writes across concurrent worker/agent invocations without depending on microsecond timestamps.
5. **Canonical Event Validation**: Strictly validates incoming event types (`tool_call`, `model_invocation`, `state_change`, `log`, `metric`). Rejects arbitrary or malformed types with HTTP 400 (`VALIDATION_ERROR`).

---

## API Endpoints (Phase 3 & Phase 4)

- `GET /health` — Foundation health probe returning runtime status, region, and table name.
- `POST /runs` — Validates input, creates a new Run, persists to DynamoDB, and returns HTTP 201.
- `GET /runs/{run_id}` — Retrieves Run by ID from DynamoDB with status, metrics, and `events_count`.
- `POST /runs/{run_id}/telemetry` — Ingests telemetry events, updates Run status, result, error, and metrics in DynamoDB.
- `GET /runs/{run_id}/telemetry` — Retrieves chronological telemetry events for a Run (oldest to newest).
- `GET /incidents` — Lists chronological incidents from DynamoDB (returns empty array `[]` when none exist; never fake data).
- `GET /incidents/{incident_id}` — Retrieves Incident by ID from DynamoDB (returns HTTP 404 if missing).
