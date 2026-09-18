import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';
import { AgentLensRepository, type IAgentLensRepository } from './repository/agentlens-repository.js';
import { ApiController } from './controllers/api-controller.js';

export function createHandler(customRepo?: IAgentLensRepository) {
  const repo = customRepo || new AgentLensRepository();
  const controller = new ApiController(repo);

  return async (
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    _context?: Context
  ): Promise<APIGatewayProxyResult | APIGatewayProxyResultV2> => {
    let path = '/';
    let method = 'GET';

    if ('rawPath' in event) {
      // API Gateway HTTP API (Payload v2)
      path = event.rawPath || '/';
      method = event.requestContext?.http?.method || 'GET';
    } else {
      // API Gateway REST API (Payload v1)
      path = event.path || '/';
      method = event.httpMethod || 'GET';
    }

    // Structured logging for CloudWatch
    console.log(`[AgentLens Lambda] Request received: ${method} ${path}`, JSON.stringify({
      method,
      path,
      timestamp: new Date().toISOString(),
      tableName: process.env.DYNAMODB_TABLE_NAME || 'agentlens-data-dev',
      region: process.env.AWS_REGION || 'ap-southeast-2',
    }));

    // Handle CORS preflight (OPTIONS)
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token',
          'Access-Control-Max-Age': '300',
        },
        body: '',
      };
    }

    // Parse JSON body if present
    let parsedBody: unknown = undefined;
    if (event.body) {
      try {
        const rawString = event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body;
        parsedBody = JSON.parse(rawString);
      } catch (err: unknown) {
        console.warn('[AgentLens Lambda] Invalid JSON body in request:', err);
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: 'Invalid JSON payload received.',
            },
            timestamp: new Date().toISOString(),
          }),
        };
      }
    }

    // Normalize path by stripping trailing slashes if longer than 1 character
    const normalizedPath = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

    // 1. GET /health
    if (method === 'GET' && (normalizedPath === '/health' || normalizedPath === '')) {
      const result = await controller.getHealth();
      return {
        statusCode: 200,
        headers: result.headers,
        // Backward-compatible with Phase 1 /health contract
        body: JSON.stringify(result.body.data),
      };
    }

    // 2. POST /runs
    if (method === 'POST' && normalizedPath === '/runs') {
      const result = await controller.createRun(parsedBody);
      return {
        statusCode: result.statusCode,
        headers: result.headers,
        body: JSON.stringify(result.body),
      };
    }

    // 3. GET /runs/{run_id}
    if (method === 'GET' && normalizedPath.startsWith('/runs/')) {
      const run_id = normalizedPath.slice('/runs/'.length);
      const result = await controller.getRun(run_id);
      return {
        statusCode: result.statusCode,
        headers: result.headers,
        body: JSON.stringify(result.body),
      };
    }

    // 4. GET /incidents
    if (method === 'GET' && normalizedPath === '/incidents') {
      const result = await controller.listIncidents();
      return {
        statusCode: result.statusCode,
        headers: result.headers,
        body: JSON.stringify(result.body),
      };
    }

    // 5. GET /incidents/{incident_id}
    if (method === 'GET' && normalizedPath.startsWith('/incidents/')) {
      const incident_id = normalizedPath.slice('/incidents/'.length);
      const result = await controller.getIncident(incident_id);
      return {
        statusCode: result.statusCode,
        headers: result.headers,
        body: JSON.stringify(result.body),
      };
    }

    // Default 404 for unrouted paths
    console.warn(`[AgentLens Lambda] Route not found: ${method} ${path}`);
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Route ${method} ${path} not found.`,
        },
        timestamp: new Date().toISOString(),
      }),
    };
  };
}

export const handler = createHandler();
