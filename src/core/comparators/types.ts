import type { Strength } from '../classification/types.js';

export interface Position {
  participantId: string;
  value: unknown;
  strength: Strength;
  sourceSeq: number;
  ts: number;
}

export type Reconciliation =
  | { status: 'aligned'; value: unknown }
  | { status: 'conflict'; between: string[]; detail: string }
  | { status: 'open'; reason: 'insufficient-coverage' | 'unresolved' };

export interface PositionComparator {
  readonly kind: string;
  reconcile(positions: Position[]): Reconciliation;
}

export interface DimensionSpec {
  id: string;
  label: string;
  comparator: PositionComparator;
  decisionRelevant: boolean;
  minCoverage: number;
}
