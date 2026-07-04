import type { RoutingRule } from './types.js';

export const humanToHumanRule: RoutingRule = {
  name: 'human-to-human',
  test: (signals) => (signals.addressee.value.kind === 'human' ? { invoke: false, reason: 'addressed to another human' } : null),
};

export const socialRule: RoutingRule = {
  name: 'social',
  test: (signals) => (signals.actionability.value.kind === 'social' ? { invoke: false, reason: 'purely social message' } : null),
};

export const deliberationRule: RoutingRule = {
  name: 'deliberation',
  test: (signals) =>
    signals.actionability.value.kind === 'deliberation' && signals.addressee.value.kind !== 'agent'
      ? { invoke: false, reason: 'humans deliberating, agent listens silently' }
      : null,
};

export const directRequestRule: RoutingRule = {
  name: 'direct-request',
  test: (signals, cfg) =>
    signals.addressee.value.kind === 'agent' && signals.addressee.confidence >= cfg.addressedThreshold
      ? { invoke: true, reason: 'directly addressed to the agent' }
      : null,
};

export const groupCommandRule: RoutingRule = {
  name: 'group-command',
  test: (signals, cfg) =>
    signals.addressee.value.kind === 'group' &&
    signals.actionability.value.kind === 'command' &&
    signals.actionability.confidence >= cfg.actionThreshold
      ? { invoke: true, reason: 'command directed at the group' }
      : null,
};

export const groupQuestionRule: RoutingRule = {
  name: 'group-question',
  test: (signals, cfg) => {
    if (!cfg.invokeOnGroupQuestion) return null;
    return signals.addressee.value.kind === 'group' &&
      signals.actionability.value.kind === 'question' &&
      signals.actionability.confidence >= cfg.actionThreshold
      ? { invoke: true, reason: 'question directed at the group' }
      : null;
  },
};

export const defaultRuleChain: RoutingRule[] = [
  humanToHumanRule,
  socialRule,
  deliberationRule,
  directRequestRule,
  groupCommandRule,
  groupQuestionRule,
];
