import { defineSignal, defineQuery, setHandler, proxyActivities, condition } from '@temporalio/workflow';
import type * as activities from '../activities/index.js';
import type { SessionEvent } from '../core/events/types.js';
import type { IncomingMessage } from '../core/events/types.js';
import { RuleBasedRoutingPolicy } from '../core/routing/policy.js';
import { toObservationEvents } from '../core/events/to-observation-events.js';
import { ProjectionRegistry } from '../core/projections/registry.js';
import { objectiveModelProjection, reconcileAllDimensions, type ObjectiveModelState } from '../core/projections/objective-model.js';
import { canonicalProjection, type CanonicalState } from '../core/projections/canonical.js';
import { presenceProjection, presentParticipantIds, type PresenceState } from '../core/projections/presence.js';
import { AlignmentDetectorImpl } from '../core/facilitation/detector.js';
import { RuleBasedFacilitationGate, facilitationKey } from '../core/facilitation/gate.js';
import type { Position, Reconciliation } from '../core/comparators/types.js';
import { DIMENSIONS } from '../domain/japan-trip.js';

const { classify, normalize, invokeReactiveAgent, invokeProactiveAgent, broadcastEvents } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
});

export const submitMessageSignal = defineSignal<[IncomingMessage]>('submitMessage');
export const joinSignal = defineSignal<[{ participantId: string; displayName: string }]>('join');
export const leaveSignal = defineSignal<[{ participantId: string }]>('leave');

// Wire-safe shapes: JSON.stringify (used both by Temporal's default payload
// converter and by the gateway forwarding this over WebSocket) silently drops
// Map contents, so the query handler must serialize Maps to plain objects
// before returning — never hand raw ObjectiveModelState/PresenceState across
// this boundary.
export interface SerializedObjectiveModelState {
  dimensions: Record<string, Record<string, Position>>;
  ratified: Record<string, { value: unknown; seq: number }>;
  lastObservationSeq: number;
}

export interface SerializedPresenceState {
  participants: Record<string, { displayName: string; connected: boolean; joinedAt: number }>;
  lastSeq: number;
}

export interface SessionState {
  events: SessionEvent[];
  objectiveModel: SerializedObjectiveModelState;
  canonical: CanonicalState;
  presence: SerializedPresenceState;
  dimensionStatus: Record<string, Reconciliation>;
}

function serializeObjectiveModel(model: ObjectiveModelState): SerializedObjectiveModelState {
  return {
    dimensions: Object.fromEntries([...model.dimensions.entries()].map(([dimId, posMap]) => [dimId, Object.fromEntries(posMap)])),
    ratified: Object.fromEntries(model.ratified),
    lastObservationSeq: model.lastObservationSeq,
  };
}

function serializePresence(presence: PresenceState): SerializedPresenceState {
  return {
    participants: Object.fromEntries(presence.participants),
    lastSeq: presence.lastSeq,
  };
}

const HISTORY_WINDOW = 12;

// The classifier needs recent context to attribute affirmations ("great",
// "works for me") to the proposal they're agreeing with — without it, every
// message is classified in isolation and agreements produce no observation
// at all, which stalls "insufficient-coverage" forever.
function buildTranscript(events: SessionEvent[]): { speaker: string; text: string }[] {
  return events
    .filter((e) => e.type === 'MessagePosted' || e.type === 'AgentMessagePosted')
    .slice(-HISTORY_WINDOW)
    .map((e) => ({
      speaker: e.type === 'AgentMessagePosted' ? 'Agent' : e.actor.kind === 'human' ? e.actor.participantId : 'unknown',
      text: (e.payload as { text: string }).text,
    }));
}

export const getStateQuery = defineQuery<SessionState>('getState');

export async function sessionWorkflow(sessionId: string): Promise<void> {
  const events: SessionEvent[] = [];
  let nextSeqValue = 0;
  const nextSeq = () => ++nextSeqValue;

  const registry = new ProjectionRegistry([objectiveModelProjection, canonicalProjection, presenceProjection]);
  const policy = new RuleBasedRoutingPolicy();
  const detector = new AlignmentDetectorImpl(DIMENSIONS);
  const gate = new RuleBasedFacilitationGate();
  const recentFacilitations: { kind: string; at: number }[] = [];

  function emit(newEvents: SessionEvent[]) {
    for (const e of newEvents) {
      events.push(e);
      registry.apply(e);
    }
    if (newEvents.length > 0) {
      // Clients only get incremental `events`, never a full re-hydrate — so
      // the derived projections (objectiveModel, presence, dimensionStatus)
      // must ride along on every broadcast, or a client's alignment sidebar
      // would freeze at whatever it looked like when that client first joined.
      void broadcastEvents(sessionId, newEvents, {
        objectiveModel: serializeObjectiveModel(registry.get<ObjectiveModelState>('objective-model')),
        presence: serializePresence(registry.get<PresenceState>('presence')),
        dimensionStatus: currentDimensionStatus(),
      });
    }
  }

  function currentDimensionStatus(): Record<string, Reconciliation> {
    const model = registry.get<ObjectiveModelState>('objective-model');
    const presence = registry.get<PresenceState>('presence');
    const map = reconcileAllDimensions(model, presentParticipantIds(presence), DIMENSIONS);
    return Object.fromEntries(map);
  }

  setHandler(joinSignal, ({ participantId, displayName }) => {
    emit([{ seq: nextSeq(), sessionId, type: 'ParticipantJoined', actor: { kind: 'system' }, payload: { participantId, displayName }, ts: Date.now() }]);
  });

  setHandler(leaveSignal, ({ participantId }) => {
    emit([{ seq: nextSeq(), sessionId, type: 'ParticipantLeft', actor: { kind: 'system' }, payload: { participantId }, ts: Date.now() }]);
  });

  setHandler(getStateQuery, () => ({
    events,
    objectiveModel: serializeObjectiveModel(registry.get<ObjectiveModelState>('objective-model')),
    canonical: registry.get<CanonicalState>('canonical'),
    presence: serializePresence(registry.get<PresenceState>('presence')),
    dimensionStatus: currentDimensionStatus(),
  }));

  setHandler(submitMessageSignal, async (msg: IncomingMessage) => {
    const classifierOutput = await classify(msg, buildTranscript(events));
    const observations = await normalize(classifierOutput.observations.value);
    const signals = {
      addressee: classifierOutput.addressee,
      actionability: classifierOutput.actionability,
      observations: { value: observations, confidence: classifierOutput.observations.confidence },
    };

    const decision = policy.decide(signals, { sessionId, presence: registry.get<PresenceState>('presence') });

    emit([{ seq: nextSeq(), sessionId, type: 'MessagePosted', actor: { kind: 'human', participantId: msg.speakerId }, payload: msg, ts: msg.ts }]);

    if (decision.applyObservations) {
      emit(toObservationEvents(msg, signals, nextSeq));
    }

    let reactiveInvoked = false;
    if (decision.invokeAgent) {
      const result = await invokeReactiveAgent({
        msg,
        signals,
        expectedVersion: registry.getVersion('canonical'),
        dimensionStatus: currentDimensionStatus(),
      });
      reactiveInvoked = true;
      emit([
        {
          seq: nextSeq(),
          sessionId,
          type: 'AgentMessagePosted',
          actor: { kind: 'agent', agentId: 'assistant', triggeredBy: { kind: 'human', participantId: msg.speakerId } },
          payload: { text: result.text },
          ts: Date.now(),
        },
      ]);
    }

    const triggers = detector.evaluate(registry.get<ObjectiveModelState>('objective-model'), registry.get<PresenceState>('presence'));
    const turn = { reactiveInvoked, lastActionability: signals.actionability.value, recentFacilitations };

    for (const trigger of triggers) {
      const outcome = gate.admit(trigger, turn, Date.now());
      if (outcome.action === 'surface') {
        recentFacilitations.push({ kind: facilitationKey(trigger), at: Date.now() });
        const result = await invokeProactiveAgent({ trigger, expectedVersion: registry.getVersion('canonical') });
        emit([
          {
            seq: nextSeq(),
            sessionId,
            type: 'AgentMessagePosted',
            actor: { kind: 'agent', agentId: 'assistant', triggeredBy: { kind: 'system' } },
            payload: { text: result.text },
            ts: Date.now(),
          },
        ]);
        if (trigger.kind === 'alignment-reached' && result.feasible) {
          const ratifyEvents = Object.entries(trigger.values).map(([dimensionId, value]) => ({
            seq: nextSeq(),
            sessionId,
            type: 'DecisionRatified',
            actor: { kind: 'agent' as const, agentId: 'assistant', triggeredBy: { kind: 'system' as const } },
            payload: { dimensionId, value },
            ts: Date.now(),
          }));
          emit(ratifyEvents);
        }
      }
      // 'fold' and 'suppress' both mean: do nothing further this tick.
    }
  });

  await condition(() => false);
}
