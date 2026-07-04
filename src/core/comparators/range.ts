import type { Position, Reconciliation, PositionComparator } from './types.js';

export interface Range {
  min: number;
  max: number;
}

export const rangeComparator: PositionComparator = {
  kind: 'range',
  reconcile(positions: Position[]): Reconciliation {
    if (positions.length === 0) return { status: 'open', reason: 'unresolved' };
    const ranges = positions.map((p) => p.value as Range);
    const intersectionMin = Math.max(...ranges.map((r) => r.min));
    const intersectionMax = Math.min(...ranges.map((r) => r.max));
    if (intersectionMin <= intersectionMax) {
      return { status: 'aligned', value: { min: intersectionMin, max: intersectionMax } };
    }
    return {
      status: 'conflict',
      between: positions.map((p) => p.participantId),
      detail: `No overlapping range across ${positions.length} positions`,
    };
  },
};
