import type { MessageSignals } from '../classification/types.js';
import type { PresenceState } from '../projections/presence.js';

export interface SessionContext {
  sessionId: string;
  presence: PresenceState;
}

export interface RouteDecision {
  applyObservations: boolean;
  invokeAgent: boolean;
  label: 'act' | 'listen' | 'ignore';
  reason: string;
}

export interface RoutingPolicyConfig {
  addressedThreshold: number;
  actionThreshold: number;
  invokeOnGroupQuestion: boolean;
}

export type InvokeVerdict = { invoke: boolean; reason: string };

export interface RoutingRule {
  readonly name: string;
  test(signals: MessageSignals, cfg: RoutingPolicyConfig, ctx: SessionContext): InvokeVerdict | null;
}

export interface RoutingPolicy {
  decide(signals: MessageSignals, ctx: SessionContext): RouteDecision;
}

export const DEFAULT_CONFIG: RoutingPolicyConfig = {
  addressedThreshold: 0.6,
  actionThreshold: 0.6,
  invokeOnGroupQuestion: true,
};
