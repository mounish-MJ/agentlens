import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Foundation: Essential directories exist', () => {
  const requiredDirs = [
    'backend',
    'frontend',
    'infrastructure',
    'contracts',
    'tests',
    'docs',
  ];

  for (const dir of requiredDirs) {
    const dirPath = path.join(rootDir, dir);
    assert.ok(fs.existsSync(dirPath), `Directory ${dir} should exist`);
    assert.ok(fs.statSync(dirPath).isDirectory(), `${dir} should be a directory`);
  }
});

test('Infrastructure: template.yaml and deploy.sh exist', () => {
  const templatePath = path.join(rootDir, 'infrastructure', 'template.yaml');
  const deployScriptPath = path.join(rootDir, 'infrastructure', 'deploy.sh');

  assert.ok(fs.existsSync(templatePath), 'infrastructure/template.yaml should exist');
  assert.ok(fs.existsSync(deployScriptPath), 'infrastructure/deploy.sh should exist');

  const templateContent = fs.readFileSync(templatePath, 'utf8');
  assert.match(templateContent, /AWS::ApiGatewayV2::Api/, 'Template should declare HTTP API');
  assert.match(templateContent, /AWS::Lambda::Function/, 'Template should declare Lambda function');
  assert.match(templateContent, /AWS::DynamoDB::Table/, 'Template should declare DynamoDB table');
  assert.match(templateContent, /AWS::Logs::LogGroup/, 'Template should declare CloudWatch log group');
});

test('Environment Separation: .env.example files exist and .env is gitignored', () => {
  const backendEnvExample = path.join(rootDir, 'backend', '.env.example');
  const frontendEnvExample = path.join(rootDir, 'frontend', '.env.example');
  const gitignorePath = path.join(rootDir, '.gitignore');

  assert.ok(fs.existsSync(backendEnvExample), 'backend/.env.example should exist');
  assert.ok(fs.existsSync(frontendEnvExample), 'frontend/.env.example should exist');
  assert.ok(fs.existsSync(gitignorePath), 'root .gitignore should exist');

  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  assert.match(gitignoreContent, /\.env/, '.gitignore must ignore .env files');
});

test('Security Audit: No AWS secret access keys or credentials in tracked source code', () => {
  const awsSecretPattern = /aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{20,}|AKIA[0-9A-Z]{16}/i;

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'dist' ||
        entry.name === 'dist-ssr'
      ) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js') || entry.name.endsWith('.json') || entry.name.endsWith('.md') || entry.name.endsWith('.yaml') || entry.name.endsWith('.sh'))) {
        const content = fs.readFileSync(fullPath, 'utf8');
        assert.ok(
          !awsSecretPattern.test(content),
          `Found potential hardcoded AWS credential in ${path.relative(rootDir, fullPath)}`
        );
      }
    }
  }

  scanDir(rootDir);
});
