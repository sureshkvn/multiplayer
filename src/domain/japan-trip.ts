import type { DimensionSpec } from '../core/comparators/types.js';
import { rangeComparator, type Range } from '../core/comparators/range.js';
import { categoricalComparator } from '../core/comparators/categorical.js';
import { setEqualityComparator } from '../core/comparators/set-equality.js';

export const DIMENSIONS: DimensionSpec[] = [
  { id: 'dates', label: 'Travel dates', comparator: rangeComparator, decisionRelevant: true, minCoverage: 1 },
  { id: 'budget', label: 'Per-person budget', comparator: rangeComparator, decisionRelevant: true, minCoverage: 1 },
  { id: 'places', label: 'Top 3 places', comparator: setEqualityComparator, decisionRelevant: true, minCoverage: 1 },
  { id: 'airline', label: 'Airline', comparator: categoricalComparator, decisionRelevant: true, minCoverage: 1 },
];
// Note: minCoverage here is a nominal floor. The real "requireAllEngaged" check
// compares engaged participantIds against the presence projection directly —
// see reconcileAllDimensions in src/core/projections/objective-model.ts.

export interface DestinationInfo {
  name: string;
  region: string;
  blurb: string;
  costTier: 1 | 2 | 3;
}

export const DESTINATIONS: DestinationInfo[] = [
  { name: 'Tokyo', region: 'Kanto', blurb: 'Neon streets, world-class food, endless neighborhoods to explore.', costTier: 2 },
  { name: 'Kyoto', region: 'Kansai', blurb: 'Temples, gardens, and geisha districts steeped in history.', costTier: 2 },
  { name: 'Osaka', region: 'Kansai', blurb: 'Street food capital with a laid-back, lively energy.', costTier: 1 },
  { name: 'Hokkaido', region: 'Hokkaido', blurb: 'Snow festivals and powder skiing in the far north.', costTier: 3 },
  { name: 'Hiroshima', region: 'Chugoku', blurb: "Peace memorial and nearby Miyajima's floating torii gate.", costTier: 1 },
  { name: 'Okinawa', region: 'Okinawa', blurb: 'Subtropical beaches and a distinct island culture.', costTier: 2 },
];

export interface AirlineOption {
  name: string;
  basePricePerPerson: number;
  peakSurchargeMultiplier: number;
}

export const AIRLINES: AirlineOption[] = [
  { name: 'ANA', basePricePerPerson: 1400, peakSurchargeMultiplier: 1.3 },
  { name: 'JAL', basePricePerPerson: 1350, peakSurchargeMultiplier: 1.35 },
  { name: 'United', basePricePerPerson: 1100, peakSurchargeMultiplier: 1.5 },
];

const COST_TIER_PER_DAY: Record<1 | 2 | 3, number> = { 1: 80, 2: 120, 3: 180 };

function isChristmasPeak(dates: Range): boolean {
  const d = new Date(dates.min);
  return d.getUTCMonth() === 11 && d.getUTCDate() >= 15;
}

export function estimateTripCostPerPerson(places: string[], airlineName: string, dates: Range): number {
  const airline = AIRLINES.find((a) => a.name.toLowerCase() === airlineName.toLowerCase());
  if (!airline) throw new Error(`Unknown airline: ${airlineName}`);

  const durationDays = Math.max(1, Math.round((dates.max - dates.min) / 86_400_000) + 1);
  const flightCost = airline.basePricePerPerson * (isChristmasPeak(dates) ? airline.peakSurchargeMultiplier : 1);
  const avgDailyCost =
    places.reduce((sum, name) => {
      const dest = DESTINATIONS.find((d) => d.name.toLowerCase() === name.toLowerCase());
      return sum + COST_TIER_PER_DAY[dest?.costTier ?? 2];
    }, 0) / Math.max(1, places.length);

  return Math.round(flightCost + avgDailyCost * durationDays);
}
