/**
 * The Instant Evals judge a connected install judges with (ADR-156 §9): the
 * judgement happens on LangWatch, and an organization without the entitlement
 * is skipped rather than refused.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  instantEvalSkipped,
  INSTANT_EVAL_SKIP_REASONS,
  type InstantEvalClassifierLimits,
  type InstantEvalJudgement,
  type InstantEvalPricing,
  type InstantEvalQuestion,
  type InstantEvalSkipReason,
} from "@langwatch/instant-eval-contract";

/** The hosted service this judge is part of, as the license names it. */
const CONNECT_INSTANT_EVALS_SERVICE = "instant_evals";

/** How long an organization's opt-in is held: one read per run, and no
 *  restart needed after an admin switches the service on. */
export const CONNECT_JUDGE_STATE_TTL_MS = 30_000;

/** A cheap bound rather than an eviction policy: dropping the lot costs one
 *  extra read per organization afterwards. */
const MAX_CACHED = 5_000;

/** Which customer a project belongs to: another feature's table, so it is
 *  stated as what licensing needs and answered by composition. */
export interface ConnectProjectOrganizations {
  /** Empty where the project is unknown, which skips rather than refuses. */
  findOrganizationIdsForProject(projectId: string): Promise<string[]>;
}

/** What a hosted judge is, to the caller that judges with it. */
export interface ConnectInstantEvalJudge {
  readonly limits: InstantEvalClassifierLimits;
  readonly pricing: InstantEvalPricing;
  classify(request: {
    readonly projectId: string;
    readonly text: string;
    readonly questions: readonly InstantEvalQuestion[];
  }): Promise<InstantEvalJudgement>;
  /** Whether this organization has hosted judging on and a license for it. */
  isAvailableForOrganization(organizationId: string): Promise<boolean>;
}

export interface ConnectInstantEvalJudgeCollaborators {
  licensing: Pick<LicensingApi, "classifyThroughConnect" | "isConnectServiceEnabled">;
  projects: ConnectProjectOrganizations;
  /** Instant Evals' own rate and markup, supplied: they are not licensing's. */
  pricing: InstantEvalPricing;
  limits: InstantEvalClassifierLimits;
  now?: () => number;
}

interface Held<T> {
  readonly readAt: number;
  readonly state: Promise<T>;
}

export class ConnectInstantEvalJudgeService implements ConnectInstantEvalJudge {
  static create(
    collaborators: ConnectInstantEvalJudgeCollaborators,
  ): ConnectInstantEvalJudgeService {
    return new ConnectInstantEvalJudgeService(collaborators);
  }

  readonly limits: InstantEvalClassifierLimits;
  readonly pricing: InstantEvalPricing;

  readonly #now: () => number;
  readonly #byOrganization = new Map<string, Held<boolean>>();

  private constructor(private readonly collaborators: ConnectInstantEvalJudgeCollaborators) {
    this.limits = collaborators.limits;
    this.pricing = collaborators.pricing;
    this.#now = collaborators.now ?? Date.now;
  }

  async classify(request: {
    readonly projectId: string;
    readonly text: string;
    readonly questions: readonly InstantEvalQuestion[];
  }): Promise<InstantEvalJudgement> {
    const organizationIds = await this.collaborators.projects.findOrganizationIdsForProject(
      request.projectId,
    );
    const [organizationId] = organizationIds;
    if (!organizationId || !(await this.isAvailableForOrganization(organizationId))) {
      return instantEvalSkipped("classifier_not_configured");
    }

    const answer = await this.collaborators.licensing.classifyThroughConnect({
      organizationId,
      text: request.text,
      questions: request.questions,
    });

    const [skipped] = knownSkipReasons(answer.skippedReason);
    return {
      verdicts: answer.verdicts,
      ...(skipped ? { skippedReason: skipped } : {}),
      inputTokens: answer.inputTokens,
      isTextTruncated: answer.isTextTruncated,
    };
  }

  /** What decides whether the eval functions are published at all. */
  isAvailableForOrganization(organizationId: string): Promise<boolean> {
    return this.#held({
      cache: this.#byOrganization,
      key: organizationId,
      read: () =>
        this.collaborators.licensing.isConnectServiceEnabled({
          organizationId,
          service: CONNECT_INSTANT_EVALS_SERVICE,
        }),
    });
  }

  /** A value held for {@link CONNECT_JUDGE_STATE_TTL_MS}, read again once it is older. */
  #held<T>({
    cache,
    key,
    read,
  }: {
    cache: Map<string, Held<T>>;
    key: string;
    read: () => Promise<T>;
  }): Promise<T> {
    const held = cache.get(key);
    if (held && this.#now() - held.readAt < CONNECT_JUDGE_STATE_TTL_MS) return held.state;
    if (cache.size >= MAX_CACHED) cache.clear();

    const state = read();
    cache.set(key, { readAt: this.#now(), state });
    return state;
  }
}

/** The skip reason the host named, when it named one this side knows. */
function knownSkipReasons(reason?: string): InstantEvalSkipReason[] {
  return INSTANT_EVAL_SKIP_REASONS.filter((known) => known === reason);
}
