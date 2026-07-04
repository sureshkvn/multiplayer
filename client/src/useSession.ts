import { useCallback, useRef, useState } from 'react';

export interface ChatEvent {
  seq: number;
  type: string;
  actor: { kind: string; participantId?: string; agentId?: string };
  payload: unknown;
  ts: number;
}

export interface SessionState {
  events: ChatEvent[];
  objectiveModel: unknown;
  canonical: unknown;
  presence: { participants: Record<string, { displayName: string; connected: boolean; joinedAt: number }> };
  dimensionStatus: Record<string, { status: string; value?: unknown; between?: string[]; detail?: string; reason?: string }>;
}

export function useSession() {
  const [state, setState] = useState<SessionState | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const join = useCallback((sessionId: string, displayName: string) => {
    const ws = new WebSocket('ws://localhost:8080');
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'join', sessionId, displayName }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'hydrate') {
        setParticipantId(msg.participantId);
        setState(normalizeState(msg.state));
      } else if (msg.type === 'events') {
        setState((prev) => {
          if (!prev) return prev;
          const next: SessionState = { ...prev, events: [...prev.events, ...msg.events] };
          if (msg.snapshot) {
            if (msg.snapshot.objectiveModel) next.objectiveModel = msg.snapshot.objectiveModel;
            if (msg.snapshot.presence) next.presence = msg.snapshot.presence;
            if (msg.snapshot.dimensionStatus) next.dimensionStatus = msg.snapshot.dimensionStatus;
          }
          return next;
        });
      }
    };

    ws.onclose = () => setConnected(false);
  }, []);

  const sendMessage = useCallback((text: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'message', text }));
  }, []);

  return { state, participantId, connected, join, sendMessage };
}

// The wire payload serializes Maps as plain objects via JSON; presence.participants
// arrives as a JSON object, not a Map, so no conversion is needed client-side.
function normalizeState(raw: unknown): SessionState {
  return raw as SessionState;
}
