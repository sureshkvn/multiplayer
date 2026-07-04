import type { SessionEvent } from '../core/events/types.js';

// `ws`'s WebSocket exposes readyState as an instance property, but the OPEN
// constant is only reliably typed as static — so we compare against the
// literal value (1) rather than depending on an instance-level OPEN member.
const WS_OPEN = 1;

export interface WsLike {
  readyState: number;
  send(data: string): void;
  on(event: 'close', cb: () => void): void;
}

const sessionSockets = new Map<string, Set<WsLike>>();

export function registerSocket(sessionId: string, socket: WsLike): void {
  const set = sessionSockets.get(sessionId) ?? new Set<WsLike>();
  set.add(socket);
  sessionSockets.set(sessionId, set);
  socket.on('close', () => set.delete(socket));
}

// `snapshot` carries the freshly-recomputed derived state (objectiveModel,
// presence, dimensionStatus) alongside the incremental events. Without it,
// clients only ever see these fields as they were at their initial hydrate —
// the alignment sidebar would silently freeze after the first message.
export async function broadcastEvents(sessionId: string, events: SessionEvent[], snapshot?: Record<string, unknown>): Promise<void> {
  const set = sessionSockets.get(sessionId);
  if (!set) return;
  const payload = JSON.stringify({ type: 'events', events, snapshot });
  for (const socket of set) {
    if (socket.readyState === WS_OPEN) socket.send(payload);
  }
}
