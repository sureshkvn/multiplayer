import { describe, it, expect } from 'vitest';
import { registerSocket, broadcastEvents } from './broadcast.js';
import type { SessionEvent } from '../core/events/types.js';

function fakeSocket() {
  const sent: string[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  return {
    readyState: 1,
    send: (data: string) => sent.push(data),
    on: (event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    },
    triggerClose: () => listeners.close?.forEach((cb) => cb()),
    sent,
  };
}

const event: SessionEvent = { seq: 1, sessionId: 's1', type: 'MessagePosted', actor: { kind: 'system' }, payload: {}, ts: 1 };

describe('broadcast registry', () => {
  it('sends events to every socket registered for a session', async () => {
    const socket = fakeSocket();
    registerSocket('s1', socket as any);
    await broadcastEvents('s1', [event]);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'events', events: [event] });
  });

  it('does not send to sockets after they close', async () => {
    const socket = fakeSocket();
    registerSocket('s2', socket as any);
    socket.triggerClose();
    await broadcastEvents('s2', [event]);
    expect(socket.sent).toHaveLength(0);
  });

  it('is a no-op for a session with no registered sockets', async () => {
    await expect(broadcastEvents('unknown-session', [event])).resolves.toBeUndefined();
  });
});
