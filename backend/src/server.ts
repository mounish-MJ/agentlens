import dotenv from 'dotenv';
dotenv.config();

import { app } from './app.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

app.listen(PORT, () => {
  console.log(`[AgentLens Backend] Server running locally at http://localhost:${PORT}`);
  console.log(`[AgentLens Backend] Health check available at http://localhost:${PORT}/health`);
});
