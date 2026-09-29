/**
 * The classifier a deployment without a key gets.
 *
 * It answers every question as skipped, which is what lets the whole feature be
 * present on a self-hosted install with nothing configured: the statement is
 * still accepted, the extraction still runs, the judged columns come back null,
 * and the result says why. The alternative — refusing the query — would make
 * the schema publish functions that never work and give a caller no way to see
 * the shape of the answer.
 *
 * Modelled on `NullLangevalsClient`, and for the same reason: a null object
 * beats a nullable dependency, because the caller then has one code path rather
 * than a branch it can forget.
 *
 * @see ./classifier.ts
 */

import {
  type InstantEvalClassifier,
  type InstantEvalJudgement,
  instantEvalSkipped,
} from "./classifier";
import { INSTANT_EVAL_PRICING } from "./pricing";
import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "./token-budget";

export class NullInstantEvalClassifier implements InstantEvalClassifier {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;

  async classify(): Promise<InstantEvalJudgement> {
    return instantEvalSkipped("classifier_not_configured");
  }
}
