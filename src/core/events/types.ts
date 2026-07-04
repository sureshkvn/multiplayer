export interface IncomingMessage {
  id: string;
  sessionId: string;
  speakerId: string;
  speakerRole: 'human' | 'agent';
  text: string;
  ts: number;
  mentions: string[];
  replyTo?: string;
}

export interface Signal<T> {
  value: T;
  confidence: number;
  rationale?: string;
}

export type Actor = { kind: 'human'; participantId: string } | { kind: 'agent'; agentId: string; triggeredBy: Actor } | { kind: 'system' };

export interface SessionEvent<P = unknown> {
  seq: number;
  sessionId: string;
  type: string;
  actor: Actor;
  payload: P;
  correlationId?: string;
  ts: number;
}

export interface Command<P = unknown> {
  type: string;
  actor: Actor;
  payload: P;
  expectedVersion?: number;
}
