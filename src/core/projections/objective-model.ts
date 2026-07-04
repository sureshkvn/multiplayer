import type { Position, Reconciliation, DimensionSpec } from '../comparators/types.js';
import type { Strength } from '../classification/types.js';
import type { Projection, StructuralEvent } from './types.js';

export interface ObjectiveModelState {
  dimensions: Map<string, Map<string, Position>>;
  ratified: Map<string, { value: unknown; seq: number }>;
  lastObservationSeq: number;
}

export const objectiveModelProjection: Projection<ObjectiveModelState> = {
  name: 'objective-model',
  initial: () => ({ dimensions: new Map(), ratified: new Map(), lastObservationSeq: 0 }),
  apply(state, event: StructuralEvent) {
    if (event.type === 'ObjectivePositionRecorded') {
      const { participantId, dimensionId, value, strength } = event.payload as {
        participantId: string;
        dimensionId: string;
        value: unknown;
        strength: Strength;
      };
      const dimMap = state.dimensions.get(dimensionId) ?? new Map<string, Position>();
      dimMap.set(participantId, { participantId, value, strength, sourceSeq: event.seq, ts: event.ts });
      state.dimensions.set(dimensionId, dimMap);
      state.lastObservationSeq = event.seq;
    } else if (event.type === 'DecisionRatified') {
      const { dimensionId, value } = event.payload as { dimensionId: string; value: unknown };
      state.ratified.set(dimensionId, { value, seq: event.seq });
    }
    return state;
  },
  version: (state) => state.lastObservationSeq,
};

export function reconcileAllDimensions(
  model: ObjectiveModelState,
  presentIds: string[],
  dimensions: DimensionSpec[],
): Map<string, Reconciliation> {
  const results = new Map<string, Reconciliation>();
  for (const dim of dimensions) {
    const posMap = model.dimensions.get(dim.id) ?? new Map<string, Position>();
    const positions = presentIds.map((id) => posMap.get(id)).filter((p): p is Position => !!p);
    if (positions.length < presentIds.length) {
      results.set(dim.id, { status: 'open', reason: 'insufficient-coverage' });
      continue;
    }
    results.set(dim.id, dim.comparator.reconcile(positions));
  }
  return results;
}
