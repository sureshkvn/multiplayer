import { describe, it, expect } from 'vitest';
import { rangeComparator } from './range.js';
import type { Position } from './types.js';

function pos(participantId: string, value: unknown, strength: Position['strength'] = 'lean'): Position {
  return { participantId, value, strength, sourceSeq: 1, ts: 1 };
}

describe('rangeComparator', () => {
  it('aligns on the intersection when ranges overlap', () => {
    const result = rangeComparator.reconcile([
      pos('alice', { min: 100, max: 200 }),
      pos('bob', { min: 150, max: 250 }),
    ]);
    expect(result).toEqual({ status: 'aligned', value: { min: 150, max: 200 } });
  });

  it('reports conflict when ranges do not overlap', () => {
    const result = rangeComparator.reconcile([
      pos('alice', { min: 100, max: 150 }),
      pos('bob', { min: 200, max: 250 }),
    ]);
    expect(result.status).toBe('conflict');
  });

  it('is open/unresolved with no positions', () => {
    expect(rangeComparator.reconcile([])).toEqual({ status: 'open', reason: 'unresolved' });
  });
});
