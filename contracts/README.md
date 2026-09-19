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
| **Incident (Primary Rep 1)** | `INCIDENT#<incident_id>` | `METADATA` | Direct point lookup by incident identifier | `GetItem(pk=INCIDENT#<id>, sk=METADATA)` (O(1)) |
| **Incident (Global Rep 2)** | `INCIDENTS` | `INCIDENT#<created_at>#<id>` | Global chronological incident timeline | `Query(pk=INCIDENTS, ScanIndexForward=false)` (O(k)) |
| **Incident (Run Assoc Rep 3)** | `RUN#<run_id>` | `INCIDENT#<created_at>#<id>` | Incidents associated with a specific Run | `Query(pk=RUN#<run_id>, begins_with(sk, 'INCIDENT#'))` (O(k)) |
| **RegressionTest** | `TEST#<test_id>` | `METADATA` | Regression test definition | `GetItem(pk=TEST#<id>, sk=METADATA)` (O(1)) |
| **Evaluation** | `EVAL#<evaluation_id>` | `METADATA` | Scorecard evaluation record | `GetItem(pk=EVAL#<id>, sk=METADATA)` (O(1)) |
| **ReplayRecord** | `REPLAY#<replay_id>` | `METADATA` | Recorded environment state snapshot | `GetItem(pk=REPLAY#<id>, sk=METADATA)` (O(1)) |

### Design Rationale & Access Patterns
1. **Zero Table Scans**: All lookups are direct point-queries (`O(1)`). Global run and incident listings query fixed partition keys (`pk = RUNS` and `pk = INCIDENTS`) with `ScanIndexForward = false` in `O(k)` (newest first). Run-associated incidents query `pk = RUN#<run_id>` with `begins_with(sk, 'INCIDENT#')`.
2. **Zero Secondary Indexes (GSI)**: Avoids extra capacity or GSI replication lag, keeping billing strictly on-demand without table scans.
3. **Atomic 3-Representation Incident Persistence**: `createIncident` writes all 3 representations atomically in a single `TransactWriteCommand`:
   - Rep 1: `pk = INCIDENT#<id>, sk = METADATA` (`entity_type = INCIDENT`)
   - Rep 2: `pk = INCIDENTS, sk = INCIDENT#<created_at>#<id>` (`entity_type = INCIDENT_INDEX`)
   - Rep 3: `pk = RUN#<run_id>, sk = INCIDENT#<created_at>#<id>` (`entity_type = RUN_INCIDENT`)
   All three writes succeed or fail together.
4. **Atomic RCA Update**: `updateIncidentRca` updates all 3 representations in a single atomic transaction without destroying unrelated fields.
5. **Observed Evidence Contract (`IncidentEvidenceItem`)**:
   ```typescript
   export interface IncidentEvidenceItem {
     event_id?: string;
     timestamp?: string;
     type?: string;
     name?: string;
     details?: Record<string, unknown>;
     metric?: string;
     value?: unknown;
   }
   ```
6. **RCA Contract (`IncidentRcaResult` & `UpdateIncidentRcaRequest`)**:
   ```typescript
   export interface IncidentRcaResult {
     primary_failure: string;
     root_cause: string;
     contributing_factors?: string[];
     severity?: IncidentSeverity;
     impact?: string;
     recommended_action?: string;
     evidence_used?: string[];
     uncertainty?: string | number;
     analyzed_at: string;
   }

   export interface UpdateIncidentRcaRequest {
     rca?: IncidentRcaResult;
     status?: IncidentStatus;
     trigger_automated_rca?: boolean;
   }
   ```
7. **RCA Integration Boundary**: Automated RCA requests (`trigger_automated_rca: true` or empty payload) return HTTP 501 `RCA_SERVICE_NOT_INTEGRATED` because automated Bedrock RCA is owned by Member 2.

---

## API Endpoints (Phase 3, 4, 5 & 6)

- `GET /health` — Foundation health probe returning runtime status, region, and table name.
- `POST /runs` — Validates input, creates a new Run, persists to DynamoDB (both primary and timeline items atomically), and returns HTTP 201.
- `GET /runs?limit={n}` — Lists chronological Runs (newest first) with validated limit (default: 50, max: 100).
- `GET /runs/{run_id}` — Retrieves Run by ID from DynamoDB with status, metrics, and `events_count`.
- `POST /runs/{run_id}/telemetry` — Ingests telemetry events, updates Run status, result, error, and metrics across both primary and timeline items.
- `GET /runs/{run_id}/telemetry?limit={n}` — Retrieves chronological telemetry events for a Run (oldest to newest).
- `GET /incidents?limit={n}&run_id={id}` — Lists chronological incidents from DynamoDB with optional Run filtering (returns empty array `[]` when none exist; never fake data).
- `POST /incidents` — Validates and persists canonical incident into all 3 representations atomically.
- `GET /incidents/{incident_id}` — Retrieves Incident by ID from DynamoDB (returns HTTP 404 if missing).
- `POST /incidents/{incident_id}/rca` — Persists structured RCA payload or returns HTTP 501 `RCA_SERVICE_NOT_INTEGRATED` on automated request.
- `GET /runs/{run_id}/incidents` — Retrieves incidents linked to a specific Run via `Query(pk=RUN#<run_id>, begins_with(sk, 'INCIDENT#'))`.
