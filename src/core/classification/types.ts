import type { Signal } from '../events/types.js';

export type Strength = 'lean' | 'prefer' | 'insist';

export type Addressee =
  | { kind: 'agent' }
  | { kind: 'human'; participantId: string }
  | { kind: 'group' }
  | { kind: 'none' };

export type Actionability =
  | { kind: 'command'; intent: string }
  | { kind: 'question' }
  | { kind: 'deliberation' }
  | { kind: 'social' };

export interface RawObservation {
  participantId: string;
  text: string;
  hint?: 'objective' | 'constraint' | 'proposal';
}

export interface ClassifierOutput {
  addressee: Signal<Addressee>;
  actionability: Signal<Actionability>;
  observations: Signal<RawObservation[]>;
}

export type ObservationPayload =
  | { scope: 'participant-objective'; participantId: string; dimensionId: string; value: unknown; strength: Strength }
  | { scope: 'constraint'; participantId: string; dimensionId: string; bound: unknown }
  | { scope: 'shared-proposal'; proposalId: string; summary: string };

export interface MessageSignals {
  addressee: Signal<Addressee>;
  actionability: Signal<Actionability>;
  observations: Signal<ObservationPayload[]>;
}
