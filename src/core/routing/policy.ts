import type { MessageSignals } from '../classification/types.js';
import { defaultRuleChain } from './rules.js';
import { DEFAULT_CONFIG } from './types.js';
import type { RouteDecision, RoutingPolicy, RoutingPolicyConfig, RoutingRule, SessionContext } from './types.js';

export class RuleBasedRoutingPolicy implements RoutingPolicy {
  constructor(
    private rules: RoutingRule[] = defaultRuleChain,
    private cfg: RoutingPolicyConfig = DEFAULT_CONFIG,
  ) {}

  decide(signals: MessageSignals, ctx: SessionContext): RouteDecision {
    const applyObservations = signals.actionability.value.kind !== 'social';

    for (const rule of this.rules) {
      const verdict = rule.test(signals, this.cfg, ctx);
      if (verdict) {
        return {
          applyObservations,
          invokeAgent: verdict.invoke,
          label: verdict.invoke ? 'act' : applyObservations ? 'listen' : 'ignore',
          reason: `${rule.name}: ${verdict.reason}`,
        };
      }
    }

    return { applyObservations, invokeAgent: false, label: 'listen', reason: 'default-silence' };
  }
}
