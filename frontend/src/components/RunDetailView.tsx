import { useState, useEffect, useCallback } from 'react';
import type { Run, TelemetryEvent } from '../types/contracts.js';
import { apiClient, ApiClientError } from '../api/client.js';

interface RunDetailViewProps {
  runId: string;
  onBack: () => void;
}

export function RunDetailView({ runId, onBack }: RunDetailViewProps) {
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<boolean>(false);

  // Payload expansion state per event_id
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  // Sample Telemetry Ingestion (for interactive live demo in browser)
  const [ingesting, setIngesting] = useState<boolean>(false);

  const fetchRunAndTelemetry = useCallback(async () => {
    try {
      const [runData, telemetryData] = await Promise.all([
        apiClient.getRun(runId),
        apiClient.getRunTelemetry(runId),
      ]);
      setRun(runData);
      setEvents(telemetryData);
      setError(null);
      setNotFound(false);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        if (err.statusCode === 404) {
          setNotFound(true);
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to load Run details.');
      }
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void fetchRunAndTelemetry();
  }, [fetchRunAndTelemetry]);

  const toggleExpand = (eventId: string) => {
    setExpandedEvents((prev) => ({
      ...prev,
      [eventId]: !prev[eventId],
    }));
  };

  const handleSimulateTelemetry = async () => {
    if (!run) return;
    setIngesting(true);
    try {
      await apiClient.ingestTelemetry(run.run_id, {
        status: 'completed',
        result: 'Workflow execution finalized successfully via AgentLens Platform.',
        metrics: {
          prompt_tokens: (run.metrics?.prompt_tokens ?? 100) + 150,
          completion_tokens: (run.metrics?.completion_tokens ?? 40) + 65,
          total_tokens: (run.metrics?.total_tokens ?? 140) + 215,
          duration_ms: (run.metrics?.duration_ms ?? 450) + 380,
          tool_calls_count: (run.metrics?.tool_calls_count ?? 0) + 1,
        },
        events: [
          {
            type: 'tool_call',
            name: 'verify_system_state',
            data: { target: 'agentlens-data-dev', region: 'ap-southeast-2' },
            duration_ms: 120,
            status: 'success',
          },
          {
            type: 'log',
            name: 'workflow_audit',
            data: { message: 'All sub-tasks verified without anomalies.' },
            status: 'success',
          },
        ],
      });
      await fetchRunAndTelemetry();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Telemetry ingestion failed');
    } finally {
      setIngesting(false);
    }
  };

  const getEventBadgeClass = (type: string) => {
    switch (type) {
      case 'tool_call':
        return 'event-tool';
      case 'model_invocation':
        return 'event-model';
      case 'state_change':
        return 'event-state';
      case 'metric':
        return 'event-metric';
      case 'log':
      default:
        return 'event-log';
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'tool_call':
        return '🔧';
      case 'model_invocation':
        return '🧠';
      case 'state_change':
        return '🔄';
      case 'metric':
        return '📊';
      case 'log':
      default:
        return '📝';
    }
  };

  if (loading) {
    return (
      <div className="view-container">
        <button className="btn-secondary btn-small" onClick={onBack}>← Back to Runs</button>
        <div className="loading-state" style={{ marginTop: '2rem' }}>
          Loading Run telemetry from DynamoDB...
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="view-container">
        <button className="btn-secondary btn-small" onClick={onBack}>← Back to Runs</button>
        <div className="card empty-state" style={{ marginTop: '2rem' }}>
          <div className="empty-icon">🔍</div>
          <h4>Run Not Found</h4>
          <p>No Run with identifier <code className="font-mono text-xs">{runId}</code> exists in DynamoDB.</p>
          <button className="btn-primary btn-small" onClick={onBack}>Return to Runs List</button>
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="view-container">
        <button className="btn-secondary btn-small" onClick={onBack}>← Back to Runs</button>
        <div className="alert-box error" style={{ marginTop: '2rem' }}>
          <span>Error loading Run: {error}</span>
          <button className="btn-small" onClick={fetchRunAndTelemetry}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      {/* Top Breadcrumb & Actions */}
      <div className="breadcrumb-bar">
        <button className="btn-secondary btn-small" onClick={onBack}>← Back to Runs</button>
        <div className="breadcrumb-divider">/</div>
        <span className="font-mono text-xs text-muted">{run.run_id}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn-secondary btn-small"
            onClick={fetchRunAndTelemetry}
            disabled={loading}
          >
            Refresh
          </button>
          <button
            className="btn-primary btn-small"
            onClick={handleSimulateTelemetry}
            disabled={ingesting}
            title="Inject telemetry into this Run to verify live DynamoDB updates"
          >
            {ingesting ? 'Ingesting...' : '+ Ingest Telemetry'}
          </button>
        </div>
      </div>

      {/* Run Header Card */}
      <div className="card run-header-card">
        <div className="run-header-top">
          <div>
            <div className="run-agent-title">
              <h2>{run.agent_name}</h2>
              <span className={`status-badge status-${run.status}`}>{run.status}</span>
            </div>
            <div className="run-id-row">
              <span className="text-muted text-xs">Run ID:</span>
              <code className="font-mono text-xs text-accent">{run.run_id}</code>
            </div>
          </div>
          <div className="run-time-meta">
            <div>
              <span className="text-muted text-xs">Created: </span>
              <span className="text-xs font-mono">{new Date(run.created_at).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted text-xs">Updated: </span>
              <span className="text-xs font-mono">{new Date(run.updated_at).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Prompt Section */}
        <div className="prompt-box">
          <div className="prompt-label">Prompt / Instruction:</div>
          <div className="prompt-text">{run.prompt}</div>
        </div>

        {/* Result or Error Box */}
        {run.result && (
          <div className="alert-box success" style={{ marginTop: '1rem' }}>
            <strong>Result:</strong> {run.result}
          </div>
        )}
        {run.error && (
          <div className="alert-box error" style={{ marginTop: '1rem' }}>
            <strong>Execution Error:</strong> {run.error}
          </div>
        )}
      </div>

      {/* Metrics Cards Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Tokens</div>
          <div className="stat-value accent-indigo">
            {run.metrics?.total_tokens !== undefined ? run.metrics.total_tokens.toLocaleString() : '—'}
          </div>
          <div className="stat-subtext">
            {run.metrics?.prompt_tokens ?? 0} prompt / {run.metrics?.completion_tokens ?? 0} comp
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Execution Duration</div>
          <div className="stat-value accent-cyan">
            {run.metrics?.duration_ms !== undefined
              ? `${(run.metrics.duration_ms / 1000).toFixed(2)}s`
              : '—'}
          </div>
          <div className="stat-subtext">
            {run.metrics?.duration_ms !== undefined ? `${run.metrics.duration_ms} ms elapsed` : 'Not recorded'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Tool Calls</div>
          <div className="stat-value accent-emerald">
            {run.metrics?.tool_calls_count ?? 0}
          </div>
          <div className="stat-subtext">External tools invoked</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Telemetry Events</div>
          <div className="stat-value accent-purple">{events.length}</div>
          <div className="stat-subtext">Persisted in event item collection</div>
        </div>
      </div>

      {/* Telemetry Timeline */}
      <div className="card timeline-panel">
        <div className="panel-header">
          <div>
            <h3 className="card-title">Chronological Execution Timeline</h3>
            <p className="card-subtitle">
              Trace of model calls, tool executions, and runtime state transitions
            </p>
          </div>
          <span className="badge-count">{events.length} events</span>
        </div>

        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📡</div>
            <h4>No Telemetry Ingested Yet</h4>
            <p>
              This Run currently has 0 telemetry events recorded. When the agent harness runs, 
              it publishes trace events to <code className="font-mono text-xs">POST /runs/{run.run_id}/telemetry</code>.
            </p>
            <button className="btn-primary btn-small" onClick={handleSimulateTelemetry} disabled={ingesting}>
              Ingest Sample Telemetry Event
            </button>
          </div>
        ) : (
          <div className="timeline-list">
            {events.map((event, idx) => {
              const isExpanded = !!expandedEvents[event.event_id];
              return (
                <div key={event.event_id} className="timeline-item">
                  <div className="timeline-spine">
                    <div className="timeline-dot">{idx + 1}</div>
                    {idx < events.length - 1 && <div className="timeline-line" />}
                  </div>

                  <div className="timeline-content">
                    <div className="timeline-header">
                      <div className="timeline-title-row">
                        <span className="timeline-icon">{getEventIcon(event.type)}</span>
                        <span className={`event-type-badge ${getEventBadgeClass(event.type)}`}>
                          {event.type}
                        </span>
                        <span className="event-name font-mono">{event.name}</span>
                        {event.status && (
                          <span className={`status-badge status-${event.status}`}>
                            {event.status}
                          </span>
                        )}
                      </div>
                      <div className="timeline-meta-row">
                        {event.duration_ms !== undefined && (
                          <span className="meta-tag">{event.duration_ms}ms</span>
                        )}
                        <span className="meta-time font-mono">
                          {new Date(event.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            fractionalSecondDigits: 3,
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Event Data Payload */}
                    {event.data && Object.keys(event.data).length > 0 && (
                      <div className="timeline-payload-container">
                        <button
                          type="button"
                          className="payload-toggle-btn"
                          onClick={() => toggleExpand(event.event_id)}
                        >
                          {isExpanded ? 'Hide Payload ▲' : 'View Payload Details ▼'}
                        </button>

                        {isExpanded && (
                          <pre className="payload-json-box">
                            {JSON.stringify(event.data, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
