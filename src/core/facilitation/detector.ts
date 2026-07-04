import type { DimensionSpec } from '../comparators/types.js';
import { reconcileAllDimensions, type ObjectiveModelState } from '../projections/objective-model.js';
import { presentParticipantIds, type PresenceState } from '../projections/presence.js';
import type { AlignmentDetector, FacilitationTrigger } from './types.js';

export class AlignmentDetectorImpl implements AlignmentDetector {
  constructor(private dimensions: DimensionSpec[]) {}

  evaluate(model: ObjectiveModelState, presence: PresenceState): FacilitationTrigger[] {
    const presentIds = presentParticipantIds(presence);
    if (presentIds.length === 0) return [];

    const results = reconcileAllDimensions(model, presentIds, this.dimensions);
    const triggers: FacilitationTrigger[] = [];
    const aligned: Record<string, unknown> = {};
    let allAligned = true;

    for (const dim of this.dimensions) {
      const result = results.get(dim.id)!;
      if (result.status === 'aligned') {
        aligned[dim.id] = result.value;
      } else {
        allAligned = false;
        if (result.status === 'conflict') {
          triggers.push({ kind: 'conflict-detected', between: result.between, on: dim.id, detail: result.detail });
        }
      }
    }

    if (allAligned) {
      triggers.push({
        kind: 'alignment-reached',
        summary: `Aligned on ${this.dimensions.map((d) => d.id).join(', ')}`,
        values: aligned,
      });
    }

    return triggers;
  }
}
