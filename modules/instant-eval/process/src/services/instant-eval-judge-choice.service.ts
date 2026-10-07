/**
 * The judge a deployment that names no classifier, or `jev`, judges with. Whether LangWatch's key
 * is set is the Instant Evals judge's to answer, and a peer Api cannot be called at startup, so
 * the choice between the key and Connect is made once, on the first call (ADR-174 decision 13).
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  INSTANT_EVAL_PRICING,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../channels/instant-eval-judge.channel.ts";

export class InstantEvalJudgeChoiceService implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;

  #chosen: Promise<InstantEvalJudgeChannel> | undefined;

  private constructor(private readonly choose: () => Promise<InstantEvalJudgeChannel>) {}

  /** `choose` runs once; a failed choice is not kept, so the next call asks again. */
  static create({
    choose,
  }: {
    choose: () => Promise<InstantEvalJudgeChannel>;
  }): InstantEvalJudgeChoiceService {
    return new InstantEvalJudgeChoiceService(choose);
  }

  async classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    return (await this.chosen()).classify(request, signal);
  }

  /** The chosen judge's answer; a judge without one judges for every organization. */
  async isAvailableForOrganization(organizationId: string): Promise<boolean> {
    const judge = await this.chosen();
    return judge.isAvailableForOrganization
      ? judge.isAvailableForOrganization(organizationId)
      : true;
  }

  async close(): Promise<void> {
    if (!this.#chosen) return;
    const judge = await this.#chosen.catch(() => undefined);
    await judge?.close?.();
  }

  private chosen(): Promise<InstantEvalJudgeChannel> {
    if (!this.#chosen) {
      this.#chosen = this.choose().catch((error: unknown) => {
        this.#chosen = undefined;
        throw error;
      });
    }
    return this.#chosen;
  }
}
