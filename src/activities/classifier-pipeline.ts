import type { IncomingMessage } from '../core/events/types.js';
import type { ClassifierOutput, MessageSignals, ObservationPayload, RawObservation } from '../core/classification/types.js';

export interface ClassifierLike {
  classify(msg: IncomingMessage): Promise<ClassifierOutput>;
}

export interface NormalizerLike {
  normalize(raw: RawObservation[]): Promise<ObservationPayload[]>;
}

export function createClassifierPipeline(classifier: ClassifierLike, normalizer: NormalizerLike) {
  async function run(msg: IncomingMessage): Promise<MessageSignals> {
    const c = await classifier.classify(msg);
    const observations = await normalizer.normalize(c.observations.value);
    return {
      addressee: c.addressee,
      actionability: c.actionability,
      observations: { value: observations, confidence: c.observations.confidence },
    };
  }

  return { run };
}
