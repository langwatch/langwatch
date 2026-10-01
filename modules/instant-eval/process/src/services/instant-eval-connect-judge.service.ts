/**
 * The judge a connected install judges with (ADR-156 §9): the text is judged on LangWatch
 * through licensing, which holds the licence and pays from its budget. An organization that
 * has not switched the service on is skipped, not refused.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  INSTANT_EVAL_SKIP_REASONS,
  instantEvalSkipped,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../channels/instant-eval-judge.channel.ts";
import { INSTANT_EVAL_PRICING } from "../rules/instant-eval-pricing.rules.ts";

/** How long an organization's opt-in is held: one read per run, no restart after a switch. */
export const CONNECT_JUDGE_STATE_TTL_MS = 30_000;

/** A cheap bound rather than an eviction policy: dropping the lot costs one read each. */
const MAX_HELD = 5_000;

type Held = Readonly<{ readAt: number; isOn: Promise<boolean> }>;

export class InstantEvalConnectJudgeService implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;

  readonly #held = new Map<string, Held>();

  private constructor(
    private readonly licensing: Pick<
      LicensingApi,
      "classifyThroughConnect" | "isConnectServiceEnabled"
    >,
    private readonly projects: Pick<ProjectApi, "findOrganizationId">,
    private readonly now: () => Instant,
  ) {}

  static create(input: {
    licensing: Pick<LicensingApi, "classifyThroughConnect" | "isConnectServiceEnabled">;
    projects: Pick<ProjectApi, "findOrganizationId">;
    now?: () => Instant;
  }): InstantEvalConnectJudgeService {
    return new InstantEvalConnectJudgeService(
      input.licensing,
      input.projects,
      input.now ?? nowInstant,
    );
  }

  async classify(request: InstantEvalClassifyRequest): Promise<InstantEvalJudgement> {
    const organizationId = await this.projects.findOrganizationId(request.projectId);
    if (!organizationId || !(await this.isAvailableForOrganization(organizationId))) {
      return instantEvalSkipped("classifier_not_configured");
    }

    const answer = await this.licensing.classifyThroughConnect({
      organizationId,
      text: request.text,
      questions: request.questions,
    });
    const [skipped] = INSTANT_EVAL_SKIP_REASONS.filter((known) => known === answer.skippedReason);
    return {
      verdicts: answer.verdicts,
      ...(skipped ? { skippedReason: skipped } : {}),
      inputTokens: answer.inputTokens,
      isTextTruncated: answer.isTextTruncated,
    };
  }

  /** Whether this organization has hosted judging on and a licence for it. */
  isAvailableForOrganization(organizationId: string): Promise<boolean> {
    const at = this.now().epochMilliseconds;
    const held = this.#held.get(organizationId);
    if (held && at - held.readAt < CONNECT_JUDGE_STATE_TTL_MS) return held.isOn;
    if (this.#held.size >= MAX_HELD) this.#held.clear();

    const isOn = this.licensing.isConnectServiceEnabled({
      organizationId,
      service: "instant_evals",
    });
    this.#held.set(organizationId, { readAt: at, isOn });
    return isOn;
  }
}
