import type { Projection, StructuralEvent } from './types.js';

export interface CanonicalState {
  ratified: Record<string, unknown>;
  lastRatifiedSeq: number;
}

export const canonicalProjection: Projection<CanonicalState> = {
  name: 'canonical',
  initial: () => ({ ratified: {}, lastRatifiedSeq: 0 }),
  apply(state, event: StructuralEvent) {
    if (event.type === 'DecisionRatified') {
      const { dimensionId, value } = event.payload as { dimensionId: string; value: unknown };
      state.ratified[dimensionId] = value;
      state.lastRatifiedSeq = event.seq;
    }
    return state;
  },
  version: (state) => state.lastRatifiedSeq,
};
