import { describe, it, expect } from 'vitest';
import { AlignmentDetectorImpl } from './detector.js';
import { objectiveModelProjection } from '../projections/objective-model.js';
import { presenceProjection } from '../projections/presence.js';
import { DIMENSIONS } from '../../domain/japan-trip.js';

function joined(seq: number, participantId: string) {
  return { seq, type: 'ParticipantJoined', payload: { participantId, displayName: participantId }, ts: seq };
}
function positionEvent(seq: number, participantId: string, dimensionId: string, value: unknown, strength = 'insist') {
  return { seq, type: 'ObjectivePositionRecorded', payload: { participantId, dimensionId, value, strength }, ts: seq };
}

describe('AlignmentDetectorImpl', () => {
  const detector = new AlignmentDetectorImpl(DIMENSIONS);

  it('fires alignment-reached only once all 4 dimensions align for all present participants', () => {
    let presence = presenceProjection.initial();
    presence = presenceProjection.apply(presence, joined(1, 'alice'));
    presence = presenceProjection.apply(presence, joined(2, 'bob'));

    let model = objectiveModelProjection.initial();
    const dates = { min: 1000, max: 2000 };
    const budget = { min: 500, max: 1000 };
    const places = ['Tokyo', 'Kyoto', 'Osaka'];
    for (const [seq, participantId] of [[10, 'alice'], [11, 'bob']] as const) {
      model = objectiveModelProjection.apply(model, positionEvent(seq, participantId, 'dates', dates));
      model = objectiveModelProjection.apply(model, positionEvent(seq + 1, participantId, 'budget', budget));
      model = objectiveModelProjection.apply(model, positionEvent(seq + 2, participantId, 'places', places));
      model = objectiveModelProjection.apply(model, positionEvent(seq + 3, participantId, 'airline', 'ANA'));
    }

    const triggers = detector.evaluate(model, presence);
    expect(triggers).toEqual([
      { kind: 'alignment-reached', summary: expect.any(String), values: { dates, budget, places, airline: 'ANA' } },
    ]);
  });

  it('reports a conflict-detected trigger for a dimension with competing insist positions', () => {
    let presence = presenceProjection.initial();
    presence = presenceProjection.apply(presence, joined(1, 'alice'));
    presence = presenceProjection.apply(presence, joined(2, 'bob'));

    let model = objectiveModelProjection.initial();
    model = objectiveModelProjection.apply(model, positionEvent(10, 'alice', 'airline', 'ANA', 'insist'));
    model = objectiveModelProjection.apply(model, positionEvent(11, 'bob', 'airline', 'JAL', 'insist'));

    const triggers = detector.evaluate(model, presence);
    expect(triggers.some((t) => t.kind === 'conflict-detected' && t.on === 'airline')).toBe(true);
  });

  it('produces no triggers when nobody is present', () => {
    const presence = presenceProjection.initial();
    const model = objectiveModelProjection.initial();
    expect(detector.evaluate(model, presence)).toEqual([]);
  });
});
