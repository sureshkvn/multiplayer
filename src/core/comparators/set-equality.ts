import type { Position, Reconciliation, PositionComparator } from './types.js';

function setKey(values: string[]): string {
  return [...values].map((v) => v.trim().toLowerCase()).sort().join('|');
}

export const setEqualityComparator: PositionComparator = {
  kind: 'set-equality',
  reconcile(positions: Position[]): Reconciliation {
    if (positions.length === 0) return { status: 'open', reason: 'unresolved' };

    const keyed = positions.map((p) => ({ p, key: setKey(p.value as string[]) }));
    const distinctKeys = new Set(keyed.map((k) => k.key));
    if (distinctKeys.size === 1) return { status: 'aligned', value: positions[0].value };

    const insisted = keyed.filter((k) => k.p.strength === 'insist');
    const insistedKeys = new Set(insisted.map((k) => k.key));

    if (insistedKeys.size === 0) return { status: 'open', reason: 'unresolved' };
    if (insistedKeys.size === 1) return { status: 'aligned', value: insisted[0].p.value };

    return {
      status: 'conflict',
      between: insisted.map((k) => k.p.participantId),
      detail: 'Competing sets of 3 places',
    };
  },
};
