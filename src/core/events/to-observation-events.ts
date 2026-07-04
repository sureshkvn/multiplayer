import type { IncomingMessage, SessionEvent } from './types.js';
import type { MessageSignals } from '../classification/types.js';

export function toObservationEvents(
  msg: IncomingMessage,
  signals: MessageSignals,
  nextSeq: () => number,
): SessionEvent[] {
  return signals.observations.value.map((obs) => {
    if (obs.scope === 'participant-objective') {
      return {
        seq: nextSeq(),
        sessionId: msg.sessionId,
        type: 'ObjectivePositionRecorded',
        actor: { kind: 'human' as const, participantId: obs.participantId },
        payload: { participantId: obs.participantId, dimensionId: obs.dimensionId, value: obs.value, strength: obs.strength },
        correlationId: msg.id,
        ts: msg.ts,
      };
    }
    if (obs.scope === 'constraint') {
      return {
        seq: nextSeq(),
        sessionId: msg.sessionId,
        type: 'ConstraintRecorded',
        actor: { kind: 'human' as const, participantId: obs.participantId },
        payload: { participantId: obs.participantId, dimensionId: obs.dimensionId, bound: obs.bound },
        correlationId: msg.id,
        ts: msg.ts,
      };
    }
    return {
      seq: nextSeq(),
      sessionId: msg.sessionId,
      type: 'ProposalRecorded',
      actor: { kind: 'human' as const, participantId: msg.speakerId },
      payload: { proposalId: obs.proposalId, summary: obs.summary },
      correlationId: msg.id,
      ts: msg.ts,
    };
  });
}
