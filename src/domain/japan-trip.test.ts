import { describe, it, expect } from 'vitest';
import { DIMENSIONS, estimateTripCostPerPerson } from './japan-trip.js';

describe('japan-trip domain', () => {
  it('defines exactly the 4 expected dimensions', () => {
    expect(DIMENSIONS.map((d) => d.id).sort()).toEqual(['airline', 'budget', 'dates', 'places']);
  });

  it('estimates a higher cost for peak Christmas dates', () => {
    const dec = { min: Date.UTC(2026, 11, 20), max: Date.UTC(2026, 11, 27) };
    const mar = { min: Date.UTC(2026, 2, 20), max: Date.UTC(2026, 2, 27) };
    const decCost = estimateTripCostPerPerson(['Tokyo', 'Kyoto', 'Osaka'], 'ANA', dec);
    const marCost = estimateTripCostPerPerson(['Tokyo', 'Kyoto', 'Osaka'], 'ANA', mar);
    expect(decCost).toBeGreaterThan(marCost);
  });

  it('throws on an unknown airline', () => {
    expect(() => estimateTripCostPerPerson(['Tokyo'], 'NotAnAirline', { min: 0, max: 86400000 })).toThrow();
  });
});
