/**
 * The Instant Evals classifier a connected install judges with (ADR-139).
 *
 * The install has no judge key of its own, so the judgement happens on
 * LangWatch and the install pays for it against the budget its license
 * carries. What leaves the install is the text being judged and the questions
 * asked about it, and only for an organization whose license names the service
 * and whose administrator has not switched it off.
 *
 * An organization without it gets the same answer as a deployment with nothing
 * configured: every question skipped, nothing sent. That is the difference
 * between a feature that is unavailable and a query that fails, and it is what
 * lets the whole surface exist on an install that is not entitled.
 *
 * The entitlement and the credential are read per project and held for
 * {@link STATE_TTL_MS}. A run judges thousands of texts, so reading the row
 * per text would turn one query into thousands of database reads; holding it
 * for the life of the process would make switching a service off need a
 * restart.
 *
 * @see ~/server/app-layer/instant-evals/classifier/classifier.ts
 * @see ../../../../../specs/self-hosting/connected-services/connect-settings.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";
import {
  INSTANT_EVAL_SKIP_REASONS,
  type InstantEvalClassifier,
  type InstantEvalClassifyRequest,
  type InstantEvalJudgement,
  type InstantEvalSkipReason,
  instantEvalSkipped,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import { INSTANT_EVAL_PRICING } from "~/server/app-layer/instant-evals/classifier/pricing";
import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "~/server/app-layer/instant-evals/classifier/token-budget";
import type { ConnectConfig } from "./connectConfig";
import { resolveConnectCredential } from "./connectCredential";
import { connectServiceEnabled } from "./connectEntitlement";
import {
  type ConnectGatewayClient,
  getConnectGatewayClient,
} from "./connectGatewayClient";
import type { ConnectCredential } from "./connectTransport";

/** The hosted service this classifier is part of, as the license names it. */
export const CONNECT_INSTANT_EVALS_SERVICE = "instant_evals";

/**
 * How long an organization's opt-in and credential are held.
 *
 * Thirty seconds: long enough that a run of ten thousand judgements reads the
 * row once, short enough that an admin who switches the service on sees the
 * next query judged without anyone restarting anything.
 */
export const STATE_TTL_MS = 30_000;

/** What a project resolves to: who it belongs to, and what they allow. */
interface ProjectConnectState {
  readonly isServiceOn: boolean;
  readonly credential: ConnectCredential | null;
}

interface CachedState<T> {
  readonly readAt: number;
  readonly state: Promise<T>;
}

/**
 * Entries one cache holds before it is dropped whole.
 *
 * A cheap bound rather than an eviction policy: entries are a few hundred
 * bytes, a process sees far fewer projects than this, and dropping the lot
 * costs one extra read per project afterwards.
 */
const MAX_CACHED = 5_000;

export interface ConnectInstantEvalClassifierOptions {
  readonly prisma: PrismaClient;
  readonly config: ConnectConfig;
  /** Injected by suites; the process's shared client otherwise. */
  readonly client?: ConnectGatewayClient;
  readonly now?: () => number;
}

export class ConnectInstantEvalClassifier implements InstantEvalClassifier {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;

  private readonly client: ConnectGatewayClient;
  private readonly now: () => number;
  private readonly byProject = new Map<
    string,
    CachedState<ProjectConnectState | null>
  >();
  private readonly byOrganization = new Map<
    string,
    CachedState<ProjectConnectState>
  >();

  constructor(private readonly options: ConnectInstantEvalClassifierOptions) {
    this.client =
      options.client ?? getConnectGatewayClient(options.config.gatewayEndpoint);
    this.now = options.now ?? (() => Date.now());
  }

  async classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    const state = await this.stateOfProject(request.projectId);
    if (!state?.isServiceOn || !state.credential) {
      return instantEvalSkipped("classifier_not_configured");
    }

    const answer = await this.client.classify({
      credential: state.credential,
      text: request.text,
      questions: request.questions,
      ...(signal ? { signal } : {}),
    });

    const skipped = skipReasonOf(answer.skippedReason);
    return {
      verdicts: answer.verdicts,
      ...(skipped ? { skippedReason: skipped } : {}),
      inputTokens: answer.inputTokens,
      isTextTruncated: answer.isTextTruncated,
    };
  }

  /**
   * Whether this organization has switched hosted judging on and holds a
   * license to do it with. What decides whether the eval functions are
   * published at all.
   */
  async isAvailableForOrganization(organizationId: string): Promise<boolean> {
    const state = await this.stateOfOrganization(organizationId);
    return state.isServiceOn && state.credential !== null;
  }

  /** A value held for {@link STATE_TTL_MS}, read again once it is older. */
  private held<T>({
    cache,
    key,
    read,
  }: {
    cache: Map<string, CachedState<T>>;
    key: string;
    read: () => Promise<T>;
  }): Promise<T> {
    const cached = cache.get(key);
    if (cached && this.now() - cached.readAt < STATE_TTL_MS) {
      return cached.state;
    }
    if (cache.size >= MAX_CACHED) cache.clear();

    const state = read();
    cache.set(key, { readAt: this.now(), state });
    return state;
  }

  private async stateOfProject(
    projectId: string,
  ): Promise<ProjectConnectState | null> {
    return await this.held({
      cache: this.byProject,
      key: projectId,
      read: () => this.readProject(projectId),
    });
  }

  private async readProject(
    projectId: string,
  ): Promise<ProjectConnectState | null> {
    const project = await this.options.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = project?.team?.organizationId;
    if (!organizationId) return null;

    return await this.stateOfOrganization(organizationId);
  }

  private async stateOfOrganization(
    organizationId: string,
  ): Promise<ProjectConnectState> {
    return await this.held({
      cache: this.byOrganization,
      key: organizationId,
      read: () => this.readOrganization(organizationId),
    });
  }

  private async readOrganization(
    organizationId: string,
  ): Promise<ProjectConnectState> {
    const { prisma } = this.options;
    const isServiceOn = await connectServiceEnabled({
      prisma,
      organizationId,
      service: CONNECT_INSTANT_EVALS_SERVICE,
    });
    if (!isServiceOn) return { isServiceOn: false, credential: null };

    return {
      isServiceOn: true,
      credential: await resolveConnectCredential({ prisma, organizationId }),
    };
  }
}

/** A skip reason the host named, where it named one this side knows. */
function skipReasonOf(reason?: string): InstantEvalSkipReason | undefined {
  return INSTANT_EVAL_SKIP_REASONS.find((known) => known === reason);
}
