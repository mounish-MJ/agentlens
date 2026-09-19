import { useState, useEffect } from 'react';
import type { Incident } from '../types/contracts.js';
import { apiClient, ApiClientError } from '../api/client.js';

interface IncidentsViewProps {
  onSelectRun?: (run_id: string) => void;
}

export function IncidentsView({ onSelectRun }: IncidentsViewProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Selected incident for detail view
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

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

  return (
    <div className="view-container">
      {/* Header */}
      <div className="view-header">
        <div>
          <h2 className="view-title">Runtime Incidents & Anomalies</h2>
          <p className="view-subtitle">
            Failure detections, tool loops, and token anomalies captured by AgentLens detectors.
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

      {/* Content */}
      {loading ? (
        <div className="loading-state">Loading incidents from DynamoDB...</div>
      ) : incidents.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">🛡️</div>
          <h4>Zero Incidents Recorded</h4>
          <p style={{ maxWidth: '560px', margin: '0 auto 1.5rem' }}>
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
        <div className="incidents-layout">
          {/* Incidents Table */}
          <div className="card table-panel" style={{ flex: 1 }}>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Incident</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Run ID</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => (
                    <tr
                      key={inc.incident_id}
                      className={`clickable-row ${selectedIncident?.incident_id === inc.incident_id ? 'selected-row' : ''}`}
                      onClick={() => setSelectedIncident(inc)}
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
                        <span className="font-mono text-xs text-muted">{inc.run_id.slice(0, 14)}...</span>
                      </td>
                      <td className="text-muted text-xs font-mono">
                        {new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected Incident Drawer/Detail */}
          {selectedIncident && (
            <div className="card incident-detail-panel">
              <div className="panel-header">
                <div>
                  <span className={`severity-badge ${getSeverityBadgeClass(selectedIncident.severity)}`}>
                    {selectedIncident.severity.toUpperCase()}
                  </span>
                  <h3 className="card-title" style={{ marginTop: '0.5rem' }}>{selectedIncident.title}</h3>
                </div>
                <button
                  className="btn-close"
                  onClick={() => setSelectedIncident(null)}
                >
                  ×
                </button>
              </div>

              <div className="incident-field">
                <div className="field-label">Incident ID</div>
                <div className="font-mono text-xs text-accent">{selectedIncident.incident_id}</div>
              </div>

              <div className="incident-field">
                <div className="field-label">Anomaly Type</div>
                <div className="font-mono text-xs">{selectedIncident.type}</div>
              </div>

              <div className="incident-field">
                <div className="field-label">Status</div>
                <span className={`status-badge status-${selectedIncident.status}`}>
                  {selectedIncident.status}
                </span>
              </div>

              <div className="incident-field">
                <div className="field-label">Associated Run ID</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <code className="font-mono text-xs">{selectedIncident.run_id}</code>
                  {onSelectRun && (
                    <button
                      className="btn-text text-accent"
                      onClick={() => onSelectRun(selectedIncident.run_id)}
                    >
                      View Run →
                    </button>
                  )}
                </div>
              </div>

              {selectedIncident.summary && (
                <div className="incident-field">
                  <div className="field-label">Summary</div>
                  <div className="summary-text">{selectedIncident.summary}</div>
                </div>
              )}

              <div className="incident-field">
                <div className="field-label">Detected Timestamp</div>
                <div className="text-muted text-xs font-mono">
                  {new Date(selectedIncident.created_at).toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
