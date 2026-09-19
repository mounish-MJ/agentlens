import { useState, useEffect, useCallback } from 'react';
import type { Incident } from '../types/contracts.js';
import { apiClient, ApiClientError } from '../api/client.js';

interface IncidentsViewProps {
  selectedIncidentId?: string | null;
  onSelectIncident?: (incident_id: string) => void;
  onBack?: () => void;
  onSelectRun?: (run_id: string) => void;
}

export function IncidentsView({
  selectedIncidentId,
  onSelectIncident,
  onBack,
  onSelectRun,
}: IncidentsViewProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Selected incident state
  const [activeIncident, setActiveIncident] = useState<Incident | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Filters for incident list
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Expanded raw evidence payloads state
  const [expandedEvidence, setExpandedEvidence] = useState<Record<number, boolean>>({});

  const fetchIncidents = async () => {
    try {
      const data = await apiClient.getIncidents();
      setIncidents(data);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to fetch incidents.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchIncidents();
  }, []);

  const loadIncidentDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await apiClient.getIncident(id);
      setActiveIncident(data);
    } catch (err: unknown) {
      setActiveIncident(null);
      if (err instanceof ApiClientError) {
        setDetailError(err.message);
      } else {
        setDetailError('Failed to load incident detail.');
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedIncidentId) {
      void loadIncidentDetail(selectedIncidentId);
    } else {
      setActiveIncident(null);
    }
  }, [selectedIncidentId, loadIncidentDetail]);

  const toggleEvidenceExpand = (idx: number) => {
    setExpandedEvidence((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const getSeverityBadgeClass = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'badge-critical';
      case 'high':
        return 'badge-high';
      case 'medium':
        return 'badge-medium';
      case 'low':
      default:
        return 'badge-low';
    }
  };

  const handleRowClick = (incident: Incident) => {
    if (onSelectIncident) {
      onSelectIncident(incident.incident_id);
    } else {
      setActiveIncident(incident);
    }
  };

  const handleBackToList = () => {
    if (onBack) {
      onBack();
    } else {
      setActiveIncident(null);
    }
  };

  // Filter incidents list
  const filteredIncidents = incidents.filter((inc) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      inc.incident_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.run_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.type.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesSeverity = severityFilter === 'all' || inc.severity === severityFilter;
    const matchesStatus = statusFilter === 'all' || inc.status === statusFilter;

    return matchesSearch && matchesSeverity && matchesStatus;
  });

  // ==========================================
  // VIEW: Incident Detail Experience
  // ==========================================
  if (selectedIncidentId || activeIncident) {
    if (detailLoading) {
      return (
        <div className="view-container">
          <button className="btn-secondary btn-small" onClick={handleBackToList}>
            ← Back to Incidents
          </button>
          <div className="loading-state" style={{ marginTop: '2rem' }}>
            Loading incident investigation from DynamoDB...
          </div>
        </div>
      );
    }

    if (detailError || !activeIncident) {
      return (
        <div className="view-container">
          <button className="btn-secondary btn-small" onClick={handleBackToList}>
            ← Back to Incidents
          </button>
          <div className="card empty-state" style={{ marginTop: '2rem' }}>
            <div className="empty-icon">⚠️</div>
            <h4>Incident Not Found</h4>
            <p>{detailError || `No incident found with ID "${selectedIncidentId}".`}</p>
            <button className="btn-primary btn-small" onClick={handleBackToList}>
              Return to Incidents List
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="view-container">
        {/* Top Breadcrumb & Back */}
        <div className="breadcrumb-bar">
          <button className="btn-secondary btn-small" onClick={handleBackToList}>
            ← Back to Incidents
          </button>
          <div className="breadcrumb-divider">/</div>
          <span className="font-mono text-xs text-muted">{activeIncident.incident_id}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-secondary btn-small"
              onClick={() => loadIncidentDetail(activeIncident.incident_id)}
              disabled={detailLoading}
            >
              Refresh
            </button>
            {onSelectRun && (
              <button
                className="btn-primary btn-small"
                onClick={() => onSelectRun(activeIncident.run_id)}
                title="Inspect the Agent Run where this incident occurred"
              >
                Inspect Associated Run →
              </button>
            )}
          </div>
        </div>

        {/* Incident Header Card */}
        <div className="card incident-detail-header-card">
          <div className="incident-header-top">
            <div>
              <div className="incident-title-row">
                <span className={`severity-badge ${getSeverityBadgeClass(activeIncident.severity)}`}>
                  {activeIncident.severity.toUpperCase()}
                </span>
                <h2>{activeIncident.title}</h2>
                <span className={`status-badge status-${activeIncident.status}`}>
                  {activeIncident.status}
                </span>
              </div>
              <div className="incident-id-meta">
                <span className="text-muted text-xs">Incident ID:</span>
                <code className="font-mono text-xs text-accent">{activeIncident.incident_id}</code>
                {activeIncident.detector_source && (
                  <>
                    <span className="bullet-sep">•</span>
                    <span className="text-muted text-xs">Source:</span>
                    <span className="badge-detector-source">{activeIncident.detector_source}</span>
                  </>
                )}
                {activeIncident.confidence !== undefined && (
                  <>
                    <span className="bullet-sep">•</span>
                    <span className="text-muted text-xs">Confidence:</span>
                    <span className="text-xs font-mono text-emerald">
                      {Math.round(activeIncident.confidence * 100)}%
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="incident-time-meta">
              <div>
                <span className="text-muted text-xs">Detected: </span>
                <span className="text-xs font-mono">
                  {new Date(activeIncident.created_at).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-muted text-xs">Updated: </span>
                <span className="text-xs font-mono">
                  {new Date(activeIncident.updated_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Associated Run Row */}
          <div className="associated-run-banner">
            <span className="run-banner-label">Associated Run:</span>
            <code className="font-mono text-xs text-accent">{activeIncident.run_id}</code>
            {onSelectRun && (
              <button
                className="btn-text text-accent text-xs"
                style={{ marginLeft: 'auto' }}
                onClick={() => onSelectRun(activeIncident.run_id)}
              >
                Go to Run Detail →
              </button>
            )}
          </div>

          {/* Summary / Failure Class */}
          <div className="incident-summary-box">
            <div className="summary-section">
              <div className="field-label">Failure Classification / Type</div>
              <div className="failure-type-tag font-mono">{activeIncident.type}</div>
            </div>
            {activeIncident.summary && (
              <div className="summary-section" style={{ marginTop: '0.75rem' }}>
                <div className="field-label">Incident Summary</div>
                <div className="summary-text-body">{activeIncident.summary}</div>
              </div>
            )}
          </div>
        </div>

        {/* Section 1: OBSERVED EXECUTION EVIDENCE */}
        <div className="card evidence-panel">
          <div className="panel-header">
            <div>
              <h3 className="card-title">Observed Execution Evidence</h3>
              <p className="card-subtitle">
                Raw runtime telemetry, tool signals, and metrics captured at the time of failure.
                Distinct from AI root-cause interpretation.
              </p>
            </div>
            <span className="badge-count">
              {activeIncident.evidence?.length ?? 0} evidence items
            </span>
          </div>

          {!activeIncident.evidence || activeIncident.evidence.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <div className="empty-icon">🔎</div>
              <h4>No Raw Execution Evidence Attached</h4>
              <p>
                No telemetry event references or raw evidence records were attached to this incident.
                Upstream detector modules (Member 2) attach observed tool calls and metric snapshots.
              </p>
            </div>
          ) : (
            <div className="evidence-list">
              {activeIncident.evidence.map((item, idx) => {
                const isExpanded = !!expandedEvidence[idx];
                return (
                  <div key={idx} className="evidence-card">
                    <div className="evidence-card-header">
                      <div className="evidence-title-row">
                        <span className="evidence-idx-badge">#{idx + 1}</span>
                        {item.type && (
                          <span className="event-type-badge event-tool">{item.type}</span>
                        )}
                        {item.name && (
                          <span className="evidence-name font-mono">{item.name}</span>
                        )}
                        {item.event_id && (
                          <span className="text-muted text-xs font-mono">
                            ID: {item.event_id}
                          </span>
                        )}
                      </div>
                      <div className="evidence-meta-row">
                        {item.metric && (
                          <span className="meta-tag">
                            {item.metric}: {String(item.value ?? '')}
                          </span>
                        )}
                        {item.timestamp && (
                          <span className="meta-time font-mono">
                            {new Date(item.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                              fractionalSecondDigits: 3,
                            })}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Raw Details / Payload */}
                    {item.details && Object.keys(item.details).length > 0 && (
                      <div className="evidence-payload-section">
                        <button
                          type="button"
                          className="payload-toggle-btn"
                          onClick={() => toggleEvidenceExpand(idx)}
                        >
                          {isExpanded ? 'Hide Raw Evidence ▲' : 'Inspect Raw Evidence Payload ▼'}
                        </button>
                        {isExpanded && (
                          <pre className="payload-json-box">
                            {JSON.stringify(item.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 2: ROOT CAUSE ANALYSIS (RCA) & RECOMMENDATIONS */}
        <div className="card rca-panel">
          <div className="panel-header">
            <div>
              <h3 className="card-title">Root Cause Analysis (RCA)</h3>
              <p className="card-subtitle">
                Automated failure diagnosis, contributing factors, and suggested remediation.
              </p>
            </div>
            {activeIncident.rca && (
              <span className="status-badge status-completed">RCA Available</span>
            )}
          </div>

          {!activeIncident.rca ? (
            <div className="rca-unavailable-box">
              <div className="rca-unavailable-icon">🤖</div>
              <div className="rca-unavailable-content">
                <h4>RCA Not Available</h4>
                <p>
                  Root cause analysis has not been conducted for this incident. In the AgentLens
                  architecture, automated Bedrock RCA is integrated by Member 2 via{' '}
                  <code className="font-mono text-xs">POST /incidents/{activeIncident.incident_id}/rca</code>.
                </p>
                <div className="rca-note-pill">
                  <span>Platform Boundary: Automated RCA will be populated when Member 2 runs diagnosis.</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rca-content-grid">
              {/* Primary Failure & Root Cause */}
              <div className="rca-highlight-card">
                <div className="rca-card-label">Primary Failure Mode</div>
                <div className="rca-failure-text">{activeIncident.rca.primary_failure}</div>

                <div className="rca-card-label" style={{ marginTop: '1.25rem' }}>Identified Root Cause</div>
                <div className="rca-root-cause-text">{activeIncident.rca.root_cause}</div>
              </div>

              {/* Recommended Action */}
              {activeIncident.rca.recommended_action && (
                <div className="rca-recommendation-card">
                  <div className="rca-card-label">Recommended Remediation Action</div>
                  <div className="rca-action-text">{activeIncident.rca.recommended_action}</div>
                </div>
              )}

              {/* Contributing Factors */}
              {activeIncident.rca.contributing_factors && activeIncident.rca.contributing_factors.length > 0 && (
                <div className="rca-factors-card">
                  <div className="rca-card-label">Contributing Factors</div>
                  <ul className="rca-factors-list">
                    {activeIncident.rca.contributing_factors.map((factor, idx) => (
                      <li key={idx}>{factor}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Meta details: Impact, Uncertainty, Evidence Used, Analyzed At */}
              <div className="rca-meta-card">
                <div className="rca-meta-row">
                  {activeIncident.rca.impact && (
                    <div className="rca-meta-item">
                      <span className="text-muted text-xs">System Impact:</span>
                      <span className="text-xs font-medium">{activeIncident.rca.impact}</span>
                    </div>
                  )}
                  {activeIncident.rca.uncertainty !== undefined && (
                    <div className="rca-meta-item">
                      <span className="text-muted text-xs">Uncertainty Rating:</span>
                      <span className="text-xs font-mono">{String(activeIncident.rca.uncertainty)}</span>
                    </div>
                  )}
                  <div className="rca-meta-item">
                    <span className="text-muted text-xs">Diagnosis Timestamp:</span>
                    <span className="text-xs font-mono">
                      {new Date(activeIncident.rca.analyzed_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                {activeIncident.rca.evidence_used && activeIncident.rca.evidence_used.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <span className="text-muted text-xs">Evidence Keys Consulted: </span>
                    <span className="text-xs font-mono text-accent">
                      {activeIncident.rca.evidence_used.join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: Incidents Table & Filter Screen
  // ==========================================
  return (
    <div className="view-container">
      {/* Header */}
      <div className="view-header">
        <div>
          <h2 className="view-title">Runtime Incidents & Diagnostics</h2>
          <p className="view-subtitle">
            Anomalies, tool loops, and failure classifications captured by AgentLens detectors.
          </p>
        </div>
        <div className="view-actions">
          <button className="btn-secondary" onClick={fetchIncidents} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-box error">
          <span>{error}</span>
          <button className="btn-small" onClick={fetchIncidents}>Retry</button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="filter-bar">
        <div className="search-box">
          <input
            type="text"
            className="form-input search-input"
            placeholder="Search by Incident ID, Title, Run ID, or Type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="severity-filter" className="filter-label">Severity:</label>
          <select
            id="severity-filter"
            className="form-select"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="status-filter" className="filter-label">Status:</label>
          <select
            id="status-filter"
            className="form-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="loading-state">Loading incidents from DynamoDB...</div>
      ) : filteredIncidents.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">🛡️</div>
          <h4>Zero Incidents Detected</h4>
          <p style={{ maxWidth: '580px', margin: '0 auto 1.5rem' }}>
            No runtime incidents currently exist in DynamoDB. In AgentLens, incident generation 
            is the responsibility of detection modules (Member 2), which run algorithms for 
            tool-loop detection, token anomaly detection, and retrieval failures.
          </p>
          <div className="empty-callout">
            <span className="callout-tag">Member 2 Integration</span>
            <span>Detectors emit incidents to <code>agentlens-data-dev</code> when anomalies occur.</span>
          </div>
        </div>
      ) : (
        <div className="card table-panel">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Incident Title / ID</th>
                  <th>Failure Type</th>
                  <th>Status</th>
                  <th>Associated Run</th>
                  <th>Evidence</th>
                  <th>RCA</th>
                  <th>Detected</th>
                </tr>
              </thead>
              <tbody>
                {filteredIncidents.map((inc) => (
                  <tr
                    key={inc.incident_id}
                    className="clickable-row"
                    onClick={() => handleRowClick(inc)}
                  >
                    <td>
                      <span className={`severity-badge ${getSeverityBadgeClass(inc.severity)}`}>
                        {inc.severity.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <div className="font-medium text-primary">{inc.title}</div>
                      <div className="text-muted text-xs font-mono">{inc.incident_id}</div>
                    </td>
                    <td>
                      <span className="font-mono text-xs">{inc.type}</span>
                    </td>
                    <td>
                      <span className={`status-badge status-${inc.status}`}>{inc.status}</span>
                    </td>
                    <td>
                      <span className="font-mono text-xs text-accent">
                        {inc.run_id.slice(0, 16)}...
                      </span>
                    </td>
                    <td>
                      <span className="text-xs">
                        {inc.evidence && inc.evidence.length > 0 ? `${inc.evidence.length} items` : '—'}
                      </span>
                    </td>
                    <td>
                      {inc.rca ? (
                        <span className="text-xs text-emerald font-medium">Available</span>
                      ) : (
                        <span className="text-xs text-muted">Not Available</span>
                      )}
                    </td>
                    <td className="text-muted text-xs font-mono">
                      {new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
