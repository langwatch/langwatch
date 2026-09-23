import { AnalyticsApi, type LangWatchQLRunCaller } from "@langwatch/analytics-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import {
  type InstantEvalActor,
  type InstantEvalApi as InstantEvalApiContract,
  InstantEvalApi,
  type InstantEvalRunInput,
  type InstantEvalJudgmentStatus,
  type InstantEvalEstimateWire,
  type InstantEvalJudgement,
  type InstantEvalQuestion,
  type InstantEvalResultsWire,
  type InstantEvalSampleWire,
  type InstantEvalRunProgress,
  type InstantEvalUsageCount,
  type InstantEvalRunReference,
  type InstantEvalRunWindow,
  type InstantEvalRunWire,
  type InstantEvalServerConfig,
  instantEvalConfig,
} from "@langwatch/instant-eval-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { createLogger } from "@langwatch/observability";
import { ProjectApi } from "@langwatch/project-contract";
import { Secret } from "@langwatch/secrets";
import { nowInstant, type Instant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";

import { HttpInstantEvalJudgeChannel } from "../channels/http/http.instant-eval-judge.channel.ts";
import type { InstantEvalCancellationChannel } from "../channels/instant-eval-cancellation.channel.ts";
import type { InstantEvalJudgeChannel } from "../channels/instant-eval-judge.channel.ts";
import { MemoryInstantEvalBudgetReservationsChannel } from "../channels/memory/memory.instant-eval-budget-reservations.channel.ts";
import { MemoryInstantEvalCancellationChannel } from "../channels/memory/memory.instant-eval-cancellation.channel.ts";
import { MemoryInstantEvalJudgeChannel } from "../channels/memory/memory.instant-eval-judge.channel.ts";
import { RedisInstantEvalBudgetReservationsChannel } from "../channels/redis/redis.instant-eval-budget-reservations.channel.ts";
import { RedisInstantEvalCancellationChannel } from "../channels/redis/redis.instant-eval-cancellation.channel.ts";
import {
  type InstantEvalRateLimiterRedis,
  RedisInstantEvalRateLimiterChannel,
} from "../channels/redis/redis.instant-eval-rate-limiter.channel.ts";
import type { InstantEvalRunExecutor } from "../eventing/instant-eval-processing.intent.ts";
import {
  InstantEvalProcessingPipelineAdapter,
  type InstantEvalProcessingPipelineDefinition,
} from "../eventing/instant-eval-processing.pipeline.ts";
import { InstantEvalRunProjectionStore } from "../eventing/instant-eval-run.store.ts";
import type { InstantEvalRepositories } from "../repositories/instant-eval.repositories.ts";
import {
  toInstantEvalEstimateWire,
  toInstantEvalJudgmentWire,
  toInstantEvalRunWire,
} from "../rules/instant-eval-wire.rules.ts";
import { InstantEvalAccessService } from "../services/instant-eval-access.service.ts";
import { InstantEvalCancelService } from "../services/instant-eval-cancel.service.ts";
import { InstantEvalClassifyService } from "../services/instant-eval-classify.service.ts";
import { InstantEvalCommandDispatcherService } from "../services/instant-eval-command-dispatcher.service.ts";
import { InstantEvalCreateService } from "../services/instant-eval-create.service.ts";
import {
  InstantEvalEstimateService,
  type InstantEvalTextSource,
} from "../services/instant-eval-estimate.service.ts";
import { InstantEvalFinishService } from "../services/instant-eval-finish.service.ts";
import { InstantEvalFreeBudgetService } from "../services/instant-eval-free-budget.service.ts";
import { InstantEvalJudgePageService } from "../services/instant-eval-judge-page.service.ts";
import { InstantEvalPlanService } from "../services/instant-eval-plan.service.ts";
import { InstantEvalReadsService } from "../services/instant-eval-reads.service.ts";
import { InstantEvalRowSourceService } from "../services/instant-eval-row-source.service.ts";
import { InstantEvalRunContextService } from "../services/instant-eval-run-context.service.ts";
import { InstantEvalRunService } from "../services/instant-eval-run.service.ts";
import { InstantEvalSampleService } from "../services/instant-eval-sample.service.ts";
import { InstantEvalSpendService } from "../services/instant-eval-spend.service.ts";
import { InstantEvalStatementService } from "../services/instant-eval-statement.service.ts";

/** Seconds of refill a bucket holds as burst, at the sustained rate. */
const logger = createLogger("langwatch:instant-eval:judge");

const BUCKET_BURST_SECONDS = 2;

/**
 * The Redis surface this module uses: the judge's token bucket, the budget
 * holds and the cancellation hint. Absent in a memory process, where each has
 * its own twin.
 */
type InstantEvalRedis = InstantEvalRateLimiterRedis & {
  del(key: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  exists(key: string): Promise<number>;
};

type InstantEvalMembers = Readonly<{
  /** The shared bucket, holds and cancel hints; absent in a memory process. */
  redis: InstantEvalRedis | null;
  /** The hosted judge a Connect installation answers from licensing (ADR-156). */
  connectJudge: InstantEvalJudgeChannel | null;
}>;

type InstantEvalDependencies = Readonly<{
  featureFlags: typeof FeatureFlagApi;
  projects: typeof ProjectApi;
  /** The query door: every statement is validated, run and extracted by it. */
  analytics: typeof AnalyticsApi;
  /** The plan that decides a run's row cap and whether the budget binds it. */
  plans: typeof EntitlementApi;
  /** The spend spine every judged token is filed on. */
  gateway: typeof GatewayApi;
  /** The query door: a filtered shorthand target resolves its trace ids here. */
  traces: typeof TraceApi;
}>;

type InstantEvalSetup = FeatureSetup<
  InstantEvalDependencies,
  InstantEvalMembers,
  InstantEvalServerConfig,
  InstantEvalRepositories
>;

export class InstantEvalApp implements InstantEvalApiContract {
  static readonly contract = InstantEvalApi;
  static readonly dependencies = {
    featureFlags: FeatureFlagApi,
    projects: ProjectApi,
    analytics: AnalyticsApi,
    plans: EntitlementApi,
    gateway: GatewayApi,
    traces: TraceApi,
  };
  static readonly config = instantEvalConfig;
  /** LangWatch's own judge credential; a deployment without one judges nothing. */
  static readonly secrets = {
    classifierApiKey: Secret.load("JEV_API_KEY", { optional: true }),
  } as const;
  /** `redis` is the shared token bucket that paces the judge across every pod. */
  static readonly reads = ["redis", "connectJudge"] as const;

  private constructor(
    private readonly access: InstantEvalAccessService,
    private readonly classifications: InstantEvalClassifyService,
    private readonly reads: InstantEvalReadsService,
    private readonly runs: InstantEvalRunService,
    private readonly dispatcher: InstantEvalCommandDispatcherService,
    private readonly pipeline: InstantEvalProcessingPipelineDefinition,
  ) {}

  static async create(setup: InstantEvalSetup): Promise<InstantEvalApp> {
    return setup.secrets.into(InstantEvalApp.secrets.classifierApiKey, (apiKey) =>
      InstantEvalApp.withSecrets(setup, apiKey),
    );
  }

  private static withSecrets(setup: InstantEvalSetup, apiKey: string | undefined): InstantEvalApp {
    const repositories = setup.repositories;
    const judge = InstantEvalApp.judgeOf(setup, apiKey);
    setup.resources.own("Instant Evals judge", () => judge.close?.() ?? Promise.resolve());

    const { analytics, projects, plans, gateway, traces } = setup.dependencies;
    const access = InstantEvalAccessService.create({
      flags: setup.dependencies.featureFlags,
      projects,
      isJudgeConfigured: () =>
        judge instanceof HttpInstantEvalJudgeChannel || judge === setup.members.connectJudge,
      judge,
    });
    const reads = InstantEvalReadsService.create({
      runs: repositories.runs,
      judgments: repositories.judgments,
    });
    const dispatcher = InstantEvalCommandDispatcherService.create();
    const rowSource = InstantEvalRowSourceService.create({ analytics });
    // The extraction half of a judged plan, which is Analytics' own: this
    // module judges the texts it answers with and never the rows behind them.
    const textSource = {
      texts: (input: Parameters<AnalyticsApi["hydrateLangWatchQLTexts"]>[0]) =>
        analytics.hydrateLangWatchQLTexts(input),
    };
    const cancellations = setup.members.redis
      ? RedisInstantEvalCancellationChannel.create(setup.members.redis)
      : MemoryInstantEvalCancellationChannel.create();
    // A hold one process keeps to itself admits the same organization's runs
    // on every other, so a bounded budget refuses a process-local store.
    if (setup.config.isBounded && !setup.members.redis) {
      throw new Error(
        "Instant Evals with a bounded free budget (INSTANT_EVAL_BOUNDED) needs a Redis connection for the budget holds, and this process has none",
      );
    }
    const budget = InstantEvalFreeBudgetService.create({
      peers: {
        findOrganizationId: ({ projectId }) => projects.findOrganizationId(projectId),
        listProjectIds: ({ organizationId }) => projects.listIdsByOrganization({ organizationId }),
        isFreePlan: async ({ organizationId }) =>
          (await plans.getActivePlan({ organizationId })).free,
        sumSpendNanoUsdByRequestType: (input) => gateway.sumSpendNanoUsdByRequestType(input),
      },
      reservations: setup.members.redis
        ? RedisInstantEvalBudgetReservationsChannel.create({ redis: setup.members.redis })
        : MemoryInstantEvalBudgetReservationsChannel.create(),
      isBounded: setup.config.isBounded,
    });
    const context = InstantEvalRunContextService.create({
      runs: repositories.runs,
      peers: {
        findProjectCaller: (input) => analytics.resolveApiKeyRunCaller(input),
        resolveProjectProtections: (input) => analytics.resolveProjectProtections(input),
        isQueryIdentityAvailable: () => analytics.isLangWatchQLAvailable(),
      },
    });

    return new InstantEvalApp(
      access,
      InstantEvalClassifyService.create({ judge }),
      reads,
      InstantEvalRunService.create({
        units: {
          statements: InstantEvalStatementService.create({ analytics, rowSource }),
          creates: InstantEvalCreateService.create({
            runs: repositories.runs,
            commands: dispatcher,
            now: () => nowInstant().epochMilliseconds,
          }),
          estimates: InstantEvalEstimateService.create({ rowSource, textSource, judge }),
          cancellations: InstantEvalCancelService.create({
            reads,
            commands: dispatcher,
            cancellations,
            now: () => nowInstant().epochMilliseconds,
          }),
          reads,
          samples: InstantEvalSampleService.create({
            judgments: repositories.judgments,
            textSource,
          }),
          budget,
        },
        peers: {
          compileFilter: (input) => traces.compileLangWatchQLTraceFilter(input),
          selectTraceIds: (input) => traces.findTraceIdsForFilter(input),
          isEnabled: (input) => access.isEnabled(input),
          isQueryIdentityAvailable: () => analytics.isLangWatchQLAvailable(),
          resolveCaller: (input) => InstantEvalApp.callerOf({ analytics, ...input }),
          getPlan: async ({ projectId }) => {
            const plan = await plans.getActivePlan({
              organizationId: await projects.getOrganizationId(projectId),
            });

            return { name: plan.name, isFree: plan.free };
          },
          database: () => analytics.langWatchQLDatabase(),
        },
      }),
      dispatcher,
      InstantEvalProcessingPipelineAdapter.create({
        instantEvalRunStore: InstantEvalRunProjectionStore.create({ runs: repositories.runs }),
        dispatch: {
          executor: InstantEvalApp.executorOf({
            context,
            rowSource,
            textSource,
            judge,
            judgments: repositories.judgments,
            cancellations,
            budget,
            analytics,
            projects,
            gateway,
          }),
          commands: () => dispatcher.outcomeCommands(),
        },
      }),
    );
  }

  /**
   * The identity a run executes as: a member's own, or the project's where the
   * asker is a credential, with that credential's protections either way.
   */
  private static async callerOf({
    analytics,
    projectId,
    actor,
  }: {
    analytics: AnalyticsApi;
    projectId: string;
    actor: InstantEvalActor;
  }): Promise<LangWatchQLRunCaller> {
    if (actor.kind === "member") {
      return analytics.resolveRunCaller({ userId: actor.userId, projectId });
    }

    return {
      project: await analytics.resolveApiKeyRunCaller({ projectId }),
      protections: await analytics.resolveApiKeyProtections({
        projectId,
        credential: actor.credential,
      }),
    };
  }

  /** The three steps the pipeline drives, each its own service. */
  private static executorOf({
    context,
    rowSource,
    textSource,
    judge,
    judgments,
    cancellations,
    budget,
    analytics,
    projects,
    gateway,
  }: {
    context: InstantEvalRunContextService;
    rowSource: InstantEvalRowSourceService;
    textSource: InstantEvalTextSource;
    judge: InstantEvalJudgeChannel;
    judgments: InstantEvalRepositories["judgments"];
    cancellations: InstantEvalCancellationChannel;
    budget: InstantEvalFreeBudgetService;
    analytics: AnalyticsApi;
    projects: ProjectApi;
    gateway: GatewayApi;
  }): InstantEvalRunExecutor {
    const plans = InstantEvalPlanService.create({
      context,
      rowSource,
      textSource,
      keyCaps: { langWatchQLKeyCapFor: (input) => analytics.langWatchQLKeyCapFor(input) },
    });
    const pages = InstantEvalJudgePageService.create({
      context,
      rowSource,
      textSource,
      judge,
      judgments,
      cancellation: cancellations,
      budget,
    });
    const finishes = InstantEvalFinishService.create({
      spend: InstantEvalSpendService.create({
        peers: {
          findSpendAttribution: async ({ projectId }) => {
            const project = await projects.findWithTeam(projectId);

            return project
              ? { organizationId: project.team.organizationId, teamId: project.team.id }
              : undefined;
          },
          recordPricedSpend: async (input) => {
            await gateway.recordPricedSpend(input);
          },
        },
      }),
      budget,
      pricing: judge.pricing,
    });

    return {
      plan: (input) => plans.plan(input),
      judgePage: (input) => pages.judgePage(input),
      finish: (input) => {
        pages.discardReadAhead({ runId: input.runId });
        return finishes.finish(input);
      },
    };
  }

  /** The pipeline this module registers, built once by {@link create}. */
  eventingPipeline(): InstantEvalProcessingPipelineDefinition {
    return this.pipeline;
  }

  /** Binds the built pipeline's own senders; every write goes through them. */
  connectCommands(commands: Readonly<Record<string, unknown>>): void {
    this.dispatcher.connect(commands);
  }

  /**
   * The install's own key always wins, so it sends nothing to LangWatch; the
   * connect judge comes next; the memory judge skips every question rather
   * than refusing every query. `null` overrides all three.
   */
  private static judgeOf(
    setup: InstantEvalSetup,
    apiKey: string | undefined,
  ): InstantEvalJudgeChannel {
    if (setup.config.classifier === "null") return MemoryInstantEvalJudgeChannel.create();
    if (setup.config.classifier === "connect") {
      if (!setup.members.connectJudge) {
        throw new Error(
          'INSTANT_EVAL_CLASSIFIER="connect" but this process composes no connect judge',
        );
      }
      return setup.members.connectJudge;
    }
    if (!apiKey) {
      if (setup.members.connectJudge) return setup.members.connectJudge;
      logger.info("No Instant Evals classifier is configured; judged columns will be skipped");
      return MemoryInstantEvalJudgeChannel.create();
    }
    const tokensPerSecond = setup.config.globalTokensPerSecond;
    const tenantTokensPerSecond = Math.min(tokensPerSecond, setup.config.tenantTokensPerSecond);
    return HttpInstantEvalJudgeChannel.create({
      apiKey,
      ...(setup.config.classifierBaseUrl ? { baseUrl: setup.config.classifierBaseUrl } : {}),
      ...(setup.config.classifierModel ? { model: setup.config.classifierModel } : {}),
      limiter: RedisInstantEvalRateLimiterChannel.create({
        redis: setup.members.redis,
        tokensPerSecond,
        capacity: tokensPerSecond * BUCKET_BURST_SECONDS,
        tenantTokensPerSecond,
        tenantCapacity: tenantTokensPerSecond * BUCKET_BURST_SECONDS,
      }),
    });
  }

  async isEnabled(input: { projectId: string }): Promise<boolean> {
    return this.access.isEnabled(input);
  }

  async isReleased(input: { projectId: string }): Promise<boolean> {
    return this.access.isReleased(input);
  }

  async findRuns(input: {
    projectId: string;
    limit: number;
    before?: Instant;
    beforeId?: string;
  }): Promise<InstantEvalRunWire[]> {
    const rows = await this.runs.findRuns(input);
    return rows.map(toInstantEvalRunWire);
  }

  async getRun(input: { projectId: string; runId: string }): Promise<InstantEvalRunWire> {
    return toInstantEvalRunWire(await this.runs.getRun(input));
  }

  async getResultsPage(input: {
    projectId: string;
    runId: string;
    limit: number;
    questionId?: string;
    isMatched?: boolean;
    status?: InstantEvalJudgmentStatus;
    cursor?: string;
  }): Promise<InstantEvalResultsWire> {
    const page = await this.runs.getResultsPage(input);
    return {
      judgments: page.judgments.map(toInstantEvalJudgmentWire),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }

  async createRun(input: {
    projectId: string;
    actor: InstantEvalActor;
    input: InstantEvalRunInput;
  }): Promise<InstantEvalRunWire> {
    return toInstantEvalRunWire(await this.runs.createRun(input));
  }

  async estimateRun(input: {
    projectId: string;
    actor: InstantEvalActor;
    input: InstantEvalRunInput;
  }): Promise<InstantEvalEstimateWire> {
    return toInstantEvalEstimateWire(await this.runs.estimateRun(input));
  }

  async cancelRun(input: {
    projectId: string;
    runId: string;
    requestedByUserId?: string;
  }): Promise<InstantEvalRunWire> {
    return toInstantEvalRunWire(await this.runs.cancelRun(input));
  }

  async getSample(input: {
    projectId: string;
    actor: InstantEvalActor;
    runId: string;
    rows: number;
  }): Promise<InstantEvalSampleWire> {
    const sample = await this.runs.getSample(input);

    return {
      rows: [...sample.rows],
      judgments: sample.judgments.map(toInstantEvalJudgmentWire),
    };
  }

  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<InstantEvalUsageCount> {
    return this.reads.countUsage(input);
  }

  async findRunProgress(input: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<InstantEvalRunProgress[]> {
    return this.reads.findRunProgress(input);
  }

  async findRunWindows(input: {
    projectId: string;
    references: readonly InstantEvalRunReference[];
  }): Promise<InstantEvalRunWindow[]> {
    return this.reads.findRunWindows(input);
  }

  async classify(input: {
    projectId: string;
    text: string;
    questions: readonly InstantEvalQuestion[];
  }): Promise<InstantEvalJudgement> {
    return this.classifications.classify(input);
  }
}
