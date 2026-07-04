import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startGateway } from '../gateway/server.js';
import * as activities from '../activities/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('Starting ephemeral Temporal server...');
  const env = await TestWorkflowEnvironment.createLocal();

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'session-tasks',
    workflowsPath: path.join(__dirname, '../workflows/session.workflow.ts'),
    activities,
  });
  const workerRun = worker.run();

  await startGateway(8080, env.client);
  console.log('Ready: gateway on ws://localhost:8080, Temporal worker running.');

  const shutdown = async () => {
    console.log('Shutting down...');
    worker.shutdown();
    await workerRun;
    await env.teardown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
