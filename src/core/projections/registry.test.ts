import { describe, it, expect } from 'vitest';
import { ProjectionRegistry } from './registry.js';
import { objectiveModelProjection } from './objective-model.js';
import { canonicalProjection } from './canonical.js';
import { presenceProjection } from './presence.js';

describe('ProjectionRegistry', () => {
  it('applies one event across all registered projections', () => {
    const registry = new ProjectionRegistry([objectiveModelProjection, canonicalProjection, presenceProjection]);
    registry.apply({
      seq: 1,
      sessionId: 's1',
      type: 'ParticipantJoined',
      actor: { kind: 'system' },
      payload: { participantId: 'alice', displayName: 'Alice' },
      ts: 1,
    });
    expect(registry.get<any>('presence').participants.get('alice')?.connected).toBe(true);
    expect(registry.getVersion('presence')).toBe(1);
  });

  it('rebuild replays a full log from scratch', () => {
    const registry = new ProjectionRegistry([presenceProjection]);
    const log = [
      { seq: 1, sessionId: 's1', type: 'ParticipantJoined', actor: { kind: 'system' as const }, payload: { participantId: 'alice', displayName: 'Alice' }, ts: 1 },
      { seq: 2, sessionId: 's1', type: 'ParticipantLeft', actor: { kind: 'system' as const }, payload: { participantId: 'alice' }, ts: 2 },
    ];
    registry.rebuild(log);
    expect(registry.get<any>('presence').participants.get('alice')?.connected).toBe(false);
    expect(registry.getVersion('presence')).toBe(2);
  });
});
