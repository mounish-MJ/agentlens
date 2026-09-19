import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { AgentLensRepository, type IAgentLensRepository } from './repository/agentlens-repository.js';
import { ApiController } from './controllers/api-controller.js';

export function createApp(customRepo?: IAgentLensRepository) {
  const repo = customRepo || new AgentLensRepository();
  const controller = new ApiController(repo);
  const application = express();

  application.use(cors());
  application.use(express.json());

  // JSON parse error handler
  application.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid JSON payload received.',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    next(err);
  });

  // GET /health
  application.get('/health', async (_req: Request, res: Response) => {
    const result = await controller.getHealth();
    res.status(result.statusCode).json(result.body.data);
  });

  // POST /runs
  application.post('/runs', async (req: Request, res: Response) => {
    const result = await controller.createRun(req.body);
    res.status(result.statusCode).json(result.body);
  });

  // GET /runs (Phase 5 List Runs)
  application.get('/runs', async (req: Request, res: Response) => {
    const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
    const result = await controller.listRuns(limit);
    res.status(result.statusCode).json(result.body);
  });

  // GET /runs/:run_id
  application.get('/runs/:run_id', async (req: Request, res: Response) => {
    const runId = Array.isArray(req.params.run_id) ? req.params.run_id[0] : req.params.run_id;
    const result = await controller.getRun(runId);
    res.status(result.statusCode).json(result.body);
  });

  // POST /runs/:run_id/telemetry (Phase 4 Ingestion Boundary)
  application.post('/runs/:run_id/telemetry', async (req: Request, res: Response) => {
    const runId = Array.isArray(req.params.run_id) ? req.params.run_id[0] : req.params.run_id;
    const result = await controller.ingestTelemetry(runId, req.body);
    res.status(result.statusCode).json(result.body);
  });

  // GET /runs/:run_id/telemetry (Phase 4 Telemetry Retrieval)
  application.get('/runs/:run_id/telemetry', async (req: Request, res: Response) => {
    const runId = Array.isArray(req.params.run_id) ? req.params.run_id[0] : req.params.run_id;
    const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
    const result = await controller.getRunTelemetry(runId, limit);
    res.status(result.statusCode).json(result.body);
  });

  // GET /incidents
  application.get('/incidents', async (_req: Request, res: Response) => {
    const result = await controller.listIncidents();
    res.status(result.statusCode).json(result.body);
  });

  // GET /incidents/:incident_id
  application.get('/incidents/:incident_id', async (req: Request, res: Response) => {
    const incidentId = Array.isArray(req.params.incident_id) ? req.params.incident_id[0] : req.params.incident_id;
    const result = await controller.getIncident(incidentId);
    res.status(result.statusCode).json(result.body);
  });

  // 404 handler
  application.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found.`,
      },
      timestamp: new Date().toISOString(),
    });
  });

  return application;
}

export const app = createApp();
