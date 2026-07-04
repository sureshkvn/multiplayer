import type { Position, Reconciliation, PositionComparator } from './types.js';

export const categoricalComparator: PositionComparator = {
  kind: 'categorical',
  reconcile(positions: Position[]): Reconciliation {
    if (positions.length === 0) return { status: 'open', reason: 'unresolved' };

    const distinctValues = new Set(positions.map((p) => p.value));
    if (distinctValues.size === 1) {
      return { status: 'aligned', value: positions[0].value };
    }

    const insisted = positions.filter((p) => p.strength === 'insist');
    const insistedValues = new Set(insisted.map((p) => p.value));

    if (insistedValues.size === 0) return { status: 'open', reason: 'unresolved' };
    if (insistedValues.size === 1) return { status: 'aligned', value: insisted[0].value };

    return {
      status: 'conflict',
      between: insisted.map((p) => p.participantId),
      detail: `Competing insist positions: ${[...insistedValues].join(', ')}`,
    };
  },
};
