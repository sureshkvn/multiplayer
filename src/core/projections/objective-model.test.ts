import { describe, it, expect } from 'vitest';
import { objectiveModelProjection, reconcileAllDimensions } from './objective-model.js';
import { DIMENSIONS } from '../../domain/japan-trip.js';

function positionEvent(seq: number, participantId: string, dimensionId: string, value: unknown, strength = 'lean') {
  return { seq, type: 'ObjectivePositionRecorded', payload: { participantId, dimensionId, value, strength }, ts: seq };
}

describe('objectiveModelProjection', () => {
  it('folds position events into the dimensions map', () => {
    let state = objectiveModelProjection.initial();
    state = objectiveModelProjection.apply(state, positionEvent(1, 'alice', 'airline', 'ANA'));
    state = objectiveModelProjection.apply(state, positionEvent(2, 'bob', 'airline', 'JAL'));
    expect(state.dimensions.get('airline')?.size).toBe(2);
    expect(objectiveModelProjection.version(state)).toBe(2);
  });

  it('last-write-wins per participant per dimension', () => {
    let state = objectiveModelProjection.initial();
    state = objectiveModelProjection.apply(state, positionEvent(1, 'alice', 'airline', 'ANA'));
    state = objectiveModelProjection.apply(state, positionEvent(2, 'alice', 'airline', 'JAL'));
    expect(state.dimensions.get('airline')?.get('alice')?.value).toBe('JAL');
    expect(state.dimensions.get('airline')?.size).toBe(1);
  });
});

describe('reconcileAllDimensions', () => {
  it('reports insufficient-coverage when a present participant has no position yet', () => {
    let state = objectiveModelProjection.initial();
    state = objectiveModelProjection.apply(state, positionEvent(1, 'alice', 'airline', 'ANA'));
    const results = reconcileAllDimensions(state, ['alice', 'bob'], DIMENSIONS);
    expect(results.get('airline')).toEqual({ status: 'open', reason: 'insufficient-coverage' });
  });

  it('reconciles once every present participant has weighed in', () => {
    let state = objectiveModelProjection.initial();
    state = objectiveModelProjection.apply(state, positionEvent(1, 'alice', 'airline', 'ANA'));
    state = objectiveModelProjection.apply(state, positionEvent(2, 'bob', 'airline', 'ANA'));
    const results = reconcileAllDimensions(state, ['alice', 'bob'], DIMENSIONS);
    expect(results.get('airline')).toEqual({ status: 'aligned', value: 'ANA' });
  });
});
