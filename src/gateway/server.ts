import { WebSocketServer, type WebSocket } from 'ws';
import type { Client } from '@temporalio/client';
import { randomUUID } from 'node:crypto';
import { sessionWorkflow, submitMessageSignal, joinSignal, leaveSignal, getStateQuery } from '../workflows/session.workflow.js';
import { registerSocket } from '../activities/broadcast.js';

const TASK_QUEUE = 'session-tasks';

export async function startGateway(port: number, client: Client): Promise<WebSocketServer> {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (socket: WebSocket) => {
    let sessionId: string | undefined;
    let participantId: string | undefined;

    socket.on('message', async (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'join') {
        sessionId = msg.sessionId;
        participantId = msg.participantId ?? randomUUID();
        registerSocket(sessionId!, socket);

        const handle = client.workflow.getHandle(sessionId!);
        try {
          await handle.describe();
        } catch {
          await client.workflow.start(sessionWorkflow, { workflowId: sessionId!, taskQueue: TASK_QUEUE, args: [sessionId!] });
        }

        const freshHandle = client.workflow.getHandle(sessionId!);
        await freshHandle.signal(joinSignal, { participantId: participantId!, displayName: msg.displayName });
        const state = await freshHandle.query(getStateQuery);
        socket.send(JSON.stringify({ type: 'hydrate', participantId, state }));
        return;
      }

      if (msg.type === 'message' && sessionId && participantId) {
        const handle = client.workflow.getHandle(sessionId);
        await handle.signal(submitMessageSignal, {
          id: randomUUID(),
          sessionId,
          speakerId: participantId,
          speakerRole: 'human' as const,
          text: msg.text,
          ts: Date.now(),
          mentions: [],
        });
      }
    });

    socket.on('close', async () => {
      if (sessionId && participantId) {
        const handle = client.workflow.getHandle(sessionId);
        await handle.signal(leaveSignal, { participantId });
      }
    });
  });

  console.log(`Gateway listening on ws://localhost:${port}`);
  return wss;
}
