import { useState, useEffect } from 'react';
import type { Run, Incident } from '../types/contracts.js';
import { apiClient, ApiClientError } from '../api/client.js';

interface OverviewViewProps {
  onSelectRun: (run_id: string) => void;
  onSelectIncident?: (incident_id: string) => void;
  onNavigateToRuns: () => void;
  onNavigateToIncidents: () => void;
  onRunCreated?: () => void;
}

export function OverviewView({
  onSelectRun,
  onSelectIncident,
  onNavigateToRuns,
  onNavigateToIncidents,
  onRunCreated,
}: OverviewViewProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Quick run creation modal/drawer
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newAgentName, setNewAgentName] = useState<string>('research-assistant');
  const [newPrompt, setNewPrompt] = useState<string>('Investigate market trends for Q3 AI agents');
  const [creating, setCreating] = useState<boolean>(false);

  const loadData = async () => {
    try {
      const [runsData, incidentsData] = await Promise.all([
        apiClient.getRuns(10),
        apiClient.getIncidents(),
      ]);
      setRuns(runsData);
      setIncidents(incidentsData);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to load overview data.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim() || !newPrompt.trim()) return;

    setCreating(true);
    try {
      const created = await apiClient.createRun({
        agent_name: newAgentName.trim(),
        prompt: newPrompt.trim(),
      });
      setShowCreateModal(false);
      await loadData();
      if (onRunCreated) onRunCreated();
      onSelectRun(created.run_id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create Run');
    } finally {
      setCreating(false);
    }
  };

  const totalRuns = runs.length;
  const completedRuns = runs.filter((r) => r.status === 'completed').length;
  const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'pending').length;
  const totalIncidents = incidents.length;

  return (
    <div className="view-container">
      {/* Page Header */}
      <div className="view-header">
        <div>
          <h2 className="view-title">System Observability Overview</h2>
          <p className="view-subtitle">
            Real-time execution telemetry, active agent workloads, and detected runtime incidents.
          </p>
        </div>
        <div className="view-actions">
          <button
            className="btn-secondary"
            onClick={loadData}
            disabled={loading}
            title="Refresh metrics from backend"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            + Create Run
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-box error">
          <span>Error loading overview: {error}</span>
          <button className="btn-small" onClick={loadData}>Retry</button>
        </div>
      )}

      {/* Metrics Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Runs</div>
          <div className="stat-value">{loading ? '—' : totalRuns}</div>
          <div className="stat-subtext">Persisted in DynamoDB</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Completed Runs</div>
          <div className="stat-value accent-emerald">{loading ? '—' : completedRuns}</div>
          <div className="stat-subtext">Successful executions</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Active / Pending</div>
          <div className="stat-value accent-cyan">{loading ? '—' : activeRuns}</div>
          <div className="stat-subtext">Awaiting or in flight</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Incidents Detected</div>
          <div className="stat-value accent-amber">{loading ? '—' : totalIncidents}</div>
          <div className="stat-subtext">Zero fake incidents</div>
        </div>
      </div>

      {/* Grid: Recent Runs & Recent Incidents */}
      <div className="dashboard-grid">
        {/* Recent Runs Section */}
        <div className="card dashboard-panel">
          <div className="panel-header">
            <div>
              <h3 className="card-title">Recent Executions</h3>
              <p className="card-subtitle">Latest Agent workflows recorded on platform</p>
            </div>
            <button className="link-button" onClick={onNavigateToRuns}>
              View All Runs →
            </button>
          </div>

          {loading ? (
            <div className="loading-state">Loading runs...</div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⚡</div>
              <h4>No Runs Recorded Yet</h4>
              <p>There are no agent executions in DynamoDB. Launch a new run to test persistence.</p>
              <button
                className="btn-primary btn-small"
                onClick={() => setShowCreateModal(true)}
              >
                Launch First Run
              </button>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Tokens</th>
                    <th>Events</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 5).map((run) => (
                    <tr
                      key={run.run_id}
                      className="clickable-row"
                      onClick={() => onSelectRun(run.run_id)}
                    >
                      <td>
                        <div className="font-medium text-primary">{run.agent_name}</div>
                        <div className="text-muted text-xs font-mono">{run.run_id.slice(0, 16)}...</div>
                      </td>
                      <td>
                        <span className={`status-badge status-${run.status}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="font-mono text-xs">
                        {run.metrics?.total_tokens !== undefined
                          ? run.metrics.total_tokens.toLocaleString()
                          : '—'}
                      </td>
                      <td>{run.events_count ?? 0}</td>
                      <td className="text-muted text-xs">
                        {new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Incidents Section */}
        <div className="card dashboard-panel">
          <div className="panel-header">
            <div>
              <h3 className="card-title">Runtime Incidents</h3>
              <p className="card-subtitle">Anomalies and failures detected across executions</p>
            </div>
            <button className="link-button" onClick={onNavigateToIncidents}>
              View Incidents →
            </button>
          </div>

          {loading ? (
            <div className="loading-state">Loading incidents...</div>
          ) : incidents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🛡️</div>
              <h4>Zero Incidents Detected</h4>
              <p>
                The platform currently has 0 recorded incidents. Detector modules (Member 2) 
                will emit real incidents when tool loops, token anomalies, or retrieval errors occur.
              </p>
            </div>
          ) : (
            <div className="incidents-list">
              {incidents.slice(0, 5).map((inc) => (
                <div
                  key={inc.incident_id}
                  className={`incident-row ${onSelectIncident ? 'clickable-row' : ''}`}
                  onClick={() => onSelectIncident?.(inc.incident_id)}
                  role={onSelectIncident ? 'button' : undefined}
                  tabIndex={onSelectIncident ? 0 : undefined}
                >
                  <div className={`severity-indicator severity-${inc.severity}`} />
                  <div className="incident-info">
                    <div className="incident-title">{inc.title}</div>
                    <div className="incident-meta">
                      <span>Type: {inc.type}</span>
                      <span>Run: {inc.run_id.slice(0, 12)}...</span>
                    </div>
                  </div>
                  <span className={`status-badge status-${inc.status}`}>{inc.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Run Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Agent Run</h3>
              <button className="btn-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateRun}>
              <div className="form-group">
                <label htmlFor="agent_name">Agent Name</label>
                <input
                  id="agent_name"
                  type="text"
                  className="form-input"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="e.g. data-retriever, coder-agent"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="prompt">Prompt / Instruction</label>
                <textarea
                  id="prompt"
                  className="form-input form-textarea"
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  rows={3}
                  placeholder="Enter the prompt or instruction for the agent..."
                  required
                />
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creating}
                >
                  {creating ? 'Persisting to DynamoDB...' : 'Create Run'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
