import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, APIGatewayProxyResult, APIGatewayProxyResultV2, Context } from 'aws-lambda';

/**
 * AWS Lambda handler entry point compatible with both API Gateway REST (v1) and HTTP API (v2).
 */
export const handler = async (
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

  // CloudWatch Logging for incoming requests
  console.log(`[AgentLens Lambda] Request received: ${method} ${path}`, JSON.stringify({
    method,
    path,
    timestamp: new Date().toISOString(),
    tableName: process.env.DYNAMODB_TABLE_NAME || 'undefined',
  }));

  // Base route / health check handler for AWS Lambda
  if (path === '/health' || path === '/') {
    console.log(`[AgentLens Lambda] Health check OK, responding 200`);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        status: 'ok',
        service: 'agentlens-backend',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
      }),
    };
  }

  console.warn(`[AgentLens Lambda] Route not found: ${method} ${path}`);
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${method} ${path} not found.`,
      },
      timestamp: new Date().toISOString(),
    }),
  };
};
