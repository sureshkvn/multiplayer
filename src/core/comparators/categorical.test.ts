import { describe, it, expect } from 'vitest';
import { categoricalComparator } from './categorical.js';
import type { Position } from './types.js';

function pos(participantId: string, value: unknown, strength: Position['strength'] = 'lean'): Position {
  return { participantId, value, strength, sourceSeq: 1, ts: 1 };
}

describe('categoricalComparator', () => {
  it('aligns when everyone holds the same value', () => {
    const result = categoricalComparator.reconcile([pos('alice', 'ANA'), pos('bob', 'ANA')]);
    expect(result).toEqual({ status: 'aligned', value: 'ANA' });
  });

  it('resolves to the insisted value when others only lean', () => {
    const result = categoricalComparator.reconcile([
      pos('alice', 'ANA', 'lean'),
      pos('bob', 'ANA', 'lean'),
      pos('carol', 'JAL', 'insist'),
    ]);
    expect(result).toEqual({ status: 'aligned', value: 'JAL' });
  });

  it('conflicts when two different values are both insisted', () => {
    const result = categoricalComparator.reconcile([
      pos('alice', 'ANA', 'insist'),
      pos('bob', 'JAL', 'insist'),
    ]);
    expect(result.status).toBe('conflict');
  });

  it('is open/unresolved when values differ and nobody insists', () => {
    const result = categoricalComparator.reconcile([pos('alice', 'ANA', 'lean'), pos('bob', 'JAL', 'prefer')]);
    expect(result).toEqual({ status: 'open', reason: 'unresolved' });
  });
});
