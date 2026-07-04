import type { Projection, StructuralEvent } from './types.js';

export interface PresenceState {
  participants: Map<string, { displayName: string; connected: boolean; joinedAt: number }>;
  lastSeq: number;
}

export const presenceProjection: Projection<PresenceState> = {
  name: 'presence',
  initial: () => ({ participants: new Map(), lastSeq: 0 }),
  apply(state, event: StructuralEvent) {
    if (event.type === 'ParticipantJoined') {
      const { participantId, displayName } = event.payload as { participantId: string; displayName: string };
      const existing = state.participants.get(participantId);
      state.participants.set(participantId, {
        displayName,
        connected: true,
        joinedAt: existing?.joinedAt ?? event.ts,
      });
      state.lastSeq = event.seq;
    } else if (event.type === 'ParticipantLeft') {
      const { participantId } = event.payload as { participantId: string };
      const existing = state.participants.get(participantId);
      if (existing) state.participants.set(participantId, { ...existing, connected: false });
      state.lastSeq = event.seq;
    }
    return state;
  },
  version: (state) => state.lastSeq,
};

export function presentParticipantIds(state: PresenceState): string[] {
  return [...state.participants.entries()].filter(([, p]) => p.connected).map(([id]) => id);
}
