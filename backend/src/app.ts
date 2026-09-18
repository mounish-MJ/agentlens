import express, { type Request, type Response } from 'express';
import cors from 'cors';

export const app = express();

app.use(cors());
app.use(express.json());

// Foundation health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'agentlens-backend',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});
