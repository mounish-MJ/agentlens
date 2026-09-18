import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { handler } from '../src/handler.js';

test('Backend App: Express instance is defined and valid', () => {
  assert.ok(app, 'Express app should be exported');
  assert.equal(typeof app.use, 'function', 'app.use should be a function');
});

test('Backend Handler: Lambda handler returns 200 for health check', async () => {
  const event = {
    path: '/health',
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: null,
    body: null,
  };

  const response = await handler(event as any);
  assert.equal(response.statusCode, 200);
  
  const body = JSON.parse(response.body);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'agentlens-backend');
});

test('Backend Handler: Lambda handler returns 404 for unknown routes', async () => {
  const event = {
    path: '/unknown',
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: null,
    body: null,
  };

  const response = await handler(event as any);
  assert.equal(response.statusCode, 404);
});
