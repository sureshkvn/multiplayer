import { describe, it, expect } from 'vitest';
import { setEqualityComparator } from './set-equality.js';
import type { Position } from './types.js';

function pos(participantId: string, value: string[], strength: Position['strength'] = 'lean'): Position {
  return { participantId, value, strength, sourceSeq: 1, ts: 1 };
}

describe('setEqualityComparator', () => {
  it('aligns when everyone names the same 3 places, order-independent', () => {
    const result = setEqualityComparator.reconcile([
      pos('alice', ['Tokyo', 'Kyoto', 'Osaka']),
      pos('bob', ['Osaka', 'Tokyo', 'Kyoto']),
    ]);
    expect(result.status).toBe('aligned');
  });

  it('conflicts when two different sets are both insisted', () => {
    const result = setEqualityComparator.reconcile([
      pos('alice', ['Tokyo', 'Kyoto', 'Osaka'], 'insist'),
      pos('bob', ['Tokyo', 'Hokkaido', 'Okinawa'], 'insist'),
    ]);
    expect(result.status).toBe('conflict');
  });

  it('is open/unresolved when sets differ and nobody insists', () => {
    const result = setEqualityComparator.reconcile([
      pos('alice', ['Tokyo', 'Kyoto', 'Osaka']),
      pos('bob', ['Tokyo', 'Hokkaido', 'Okinawa']),
    ]);
    expect(result).toEqual({ status: 'open', reason: 'unresolved' });
  });
});
