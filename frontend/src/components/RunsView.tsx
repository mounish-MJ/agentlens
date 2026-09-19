import { useState, useEffect } from 'react';
import type { Run } from '../types/contracts.js';
import { apiClient, ApiClientError } from '../api/client.js';

interface RunsViewProps {
  onSelectRun: (run_id: string) => void;
}

export function RunsView({ onSelectRun }: RunsViewProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Quick Run Creation
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [agentName, setAgentName] = useState<string>('browser-eval-agent');
  const [prompt, setPrompt] = useState<string>('Execute regression verification on flight booking form');
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  const fetchRuns = async () => {
    try {
      const data = await apiClient.getRuns(50);
      setRuns(data);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to fetch runs.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRuns();
  }, []);

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim() || !prompt.trim()) return;

    setIsCreating(true);
    try {
      const newRun = await apiClient.createRun({
        agent_name: agentName.trim(),
        prompt: prompt.trim(),
      });
      setShowCreateForm(false);
      await fetchRuns();
      onSelectRun(newRun.run_id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create Run');
    } finally {
      setIsCreating(false);
    }
  };

  // Filtered runs
  const filteredRuns = runs.filter((run) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      run.run_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      run.agent_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      run.prompt.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || run.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="view-container">
      {/* Header */}
      <div className="view-header">
        <div>
          <h2 className="view-title">Agent Execution Runs</h2>
          <p className="view-subtitle">
            All agent execution lifecycles and telemetry records persisted in DynamoDB.
          </p>
        </div>
        <div className="view-actions">
          <button className="btn-secondary" onClick={fetchRuns} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button className="btn-primary" onClick={() => setShowCreateForm(true)}>
            + New Run
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-box error">
          <span>{error}</span>
          <button className="btn-small" onClick={fetchRuns}>Retry</button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="filter-bar">
        <div className="search-box">
          <input
            type="text"
            className="form-input search-input"
            placeholder="Search by Run ID, Agent name, or prompt..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
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
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Runs Table */}
      {loading ? (
        <div className="loading-state">Loading runs from DynamoDB...</div>
      ) : filteredRuns.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">📋</div>
          <h4>No Runs Found</h4>
          <p>
            {runs.length === 0
              ? 'No agent executions exist yet. Create a run or publish telemetry from your agent harness.'
              : 'No runs matched your current search and filter criteria.'}
          </p>
          {runs.length === 0 && (
            <button className="btn-primary btn-small" onClick={() => setShowCreateForm(true)}>
              Create First Run
            </button>
          )}
        </div>
      ) : (
        <div className="card table-panel">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Tokens</th>
                  <th>Duration</th>
                  <th>Events</th>
                  <th>Created At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr
                    key={run.run_id}
                    className="clickable-row"
                    onClick={() => onSelectRun(run.run_id)}
                  >
                    <td>
                      <span className="font-mono text-xs text-accent">{run.run_id}</span>
                    </td>
                    <td>
                      <span className="font-medium text-primary">{run.agent_name}</span>
                    </td>
                    <td>
                      <span className={`status-badge status-${run.status}`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="font-mono text-xs">
                      {run.metrics?.total_tokens !== undefined ? (
                        <span>
                          {run.metrics.total_tokens.toLocaleString()}{' '}
                          <span className="text-muted">
                            ({run.metrics.prompt_tokens ?? 0}p / {run.metrics.completion_tokens ?? 0}c)
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="font-mono text-xs">
                      {run.metrics?.duration_ms !== undefined ? (
                        `${(run.metrics.duration_ms / 1000).toFixed(2)}s`
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className="badge-count">{run.events_count ?? 0}</span>
                    </td>
                    <td className="text-muted text-xs">
                      {new Date(run.created_at).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>
                      <button
                        className="btn-text text-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectRun(run.run_id);
                        }}
                      >
                        Inspect →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Create Run */}
      {showCreateForm && (
        <div className="modal-overlay" onClick={() => setShowCreateForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Launch New Run</h3>
              <button className="btn-close" onClick={() => setShowCreateForm(false)}>×</button>
            </div>
            <form onSubmit={handleCreateRun}>
              <div className="form-group">
                <label htmlFor="modal_agent_name">Agent Name</label>
                <input
                  id="modal_agent_name"
                  type="text"
                  className="form-input"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g. data-retriever, coder-agent"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="modal_prompt">Prompt</label>
                <textarea
                  id="modal_prompt"
                  className="form-input form-textarea"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  placeholder="Enter instruction for agent..."
                  required
                />
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCreateForm(false)}
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isCreating}>
                  {isCreating ? 'Creating in DynamoDB...' : 'Create Run'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
