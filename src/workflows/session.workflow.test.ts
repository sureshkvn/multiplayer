import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sessionWorkflow, submitMessageSignal, joinSignal, getStateQuery } from './session.workflow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('sessionWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  }, 30_000);

  afterAll(async () => {
    await env?.teardown();
  });

  it('records a message and invokes the reactive agent when directly addressed', async () => {
    const taskQueue = 'test-session-tasks';
    const mockActivities = {
      classify: async () => ({
        addressee: { value: { kind: 'agent' }, confidence: 0.95 },
        actionability: { value: { kind: 'question' }, confidence: 0.9 },
        observations: { value: [], confidence: 0.9 },
      }),
      normalize: async () => [],
      invokeReactiveAgent: async () => ({ text: 'Sure, happy to help!' }),
      invokeProactiveAgent: async () => ({ text: 'unused', feasible: false }),
      broadcastEvents: async () => {},
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: path.join(__dirname, 'session.workflow.ts'),
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(sessionWorkflow, {
        workflowId: 'test-session-1',
        taskQueue,
        args: ['test-session-1'],
      });

      await handle.signal(joinSignal, { participantId: 'alice', displayName: 'Alice' });
      await handle.signal(submitMessageSignal, {
        id: 'm1',
        sessionId: 'test-session-1',
        speakerId: 'alice',
        speakerRole: 'human',
        text: 'hey agent, what do you think?',
        ts: Date.now(),
        mentions: [],
      });

      // Give the async signal handler a moment to run within the test environment.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const state = await handle.query(getStateQuery);
      expect(state.events.some((e) => e.type === 'MessagePosted')).toBe(true);
      expect(state.events.some((e) => e.type === 'AgentMessagePosted')).toBe(true);

      await handle.terminate();
    });
  }, 30_000);
});
