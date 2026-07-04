import Anthropic from '@anthropic-ai/sdk';
import { createClassifier } from './classifier.js';
import { createNormalizer } from './normalizer.js';
import { createAgentInvoker } from './agent-invocation.js';
import { DIMENSIONS } from '../domain/japan-trip.js';

const client = new Anthropic();

export const { classify } = createClassifier(client);
export const { normalize } = createNormalizer(client, DIMENSIONS);
export const { invokeReactiveAgent, invokeProactiveAgent } = createAgentInvoker(client);
export { broadcastEvents, registerSocket } from './broadcast.js';
