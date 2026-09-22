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
  type InstantEvalResultsWire,
  type InstantEvalSampleWire,
  type InstantEvalRunProgress,
  type InstantEvalRunWire,
  type InstantEvalServerConfig,
  instantEvalConfig,
} from "@langwatch/instant-eval-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { ProjectApi } from "@langwatch/project-contract";
import { Secret } from "@langwatch/secrets";
import { nowInstant, type Instant } from "@langwatch/time";

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
import { ClickHouseInstantEvalRepositories } from "../repositories/clickhouse/clickhouse.instant-eval.repositories.ts";
import type { InstantEvalRepositories } from "../repositories/instant-eval.repositories.ts";
import {
  toInstantEvalEstimateWire,
  toInstantEvalJudgmentWire,
  toInstantEvalRunWire,
} from "../rules/instant-eval-wire.rules.ts";
import { InstantEvalAccessService } from "../services/instant-eval-access.service.ts";
import { InstantEvalCancelService } from "../services/instant-eval-cancel.service.ts";
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
import type {
  InstantEvalClickHouseClient,
  InstantEvalClickHouseResolver,
} from "./instant-eval.members.ts";

/** Seconds of refill a bucket holds as burst, at the sustained rate. */
const BUCKET_BURST_SECONDS = 2;

/**
 * The process's one routing ClickHouse member, carried per tenant. Not a
 * second connection — the member already routes and guards every statement.
 */
type InstantEvalClickHouseMember = {
  query<T>(input: {
    tenantId: string;
    sql: string;
    params?: Record<string, unknown>;
    settings?: Record<string, string | number>;
  }): Promise<{ rows: T[] }>;
  insert(input: {
    tenantId: string;
    table: string;
    rows: Record<string, unknown>[];
    settings?: Record<string, string | number>;
  }): Promise<unknown>;
};

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
  clickhouse: InstantEvalClickHouseMember;
  /** The shared bucket, holds and cancel hints; absent in a memory process. */
  redis: InstantEvalRedis | null;
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
}>;

type InstantEvalSetup = FeatureSetup<
  InstantEvalDependencies,
  InstantEvalMembers,
  InstantEvalServerConfig
>;

class ClickHouseMemberSession implements InstantEvalClickHouseClient {
  constructor(
    private readonly clickhouse: InstantEvalClickHouseMember,
    private readonly tenantId: string,
  ) {}

  async query<T>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<{ json(): Promise<T[]> }> {
    const { rows } = await this.clickhouse.query<T>({
      tenantId: this.tenantId,
      sql: input.query,
      ...(input.query_params ? { params: input.query_params } : {}),
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
    return { json: () => Promise.resolve(rows) };
  }

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
    return undefined;
  }
}

/** The settings the member takes: booleans and absences dropped. */
function settingsOf(
  settings: Record<string, string | number | boolean | undefined>,
): Record<string, string | number> {
  const carried: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number") carried[name] = value;
    else if (typeof value === "boolean") carried[name] = value ? 1 : 0;
  }
  return carried;
}

export class InstantEvalApp implements InstantEvalApiContract {
  static readonly contract = InstantEvalApi;
  static readonly dependencies = {
    featureFlags: FeatureFlagApi,
    projects: ProjectApi,
    analytics: AnalyticsApi,
    plans: EntitlementApi,
    gateway: GatewayApi,
  };
  static readonly config = instantEvalConfig;
  /** LangWatch's own judge credential; a deployment without one judges nothing. */
  static readonly secrets = {
    classifierApiKey: Secret.load("JEV_API_KEY", { optional: true }),
  } as const;
  /**
   * `clickhouse` is where both of this module's tables live; `redis` is the
   * shared token bucket that paces the judge across every pod.
   */
  static readonly reads = ["clickhouse", "redis"] as const;

  private constructor(
    private readonly access: InstantEvalAccessService,
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
    const repositories = InstantEvalApp.repositoriesOf(setup);
    const judge = InstantEvalApp.judgeOf(setup, apiKey);
    setup.resources.own("Instant Evals judge", () => judge.close?.() ?? Promise.resolve());

    const { analytics, projects, plans, gateway } = setup.dependencies;
    const access = InstantEvalAccessService.create({
      flags: setup.dependencies.featureFlags,
      projects,
      isJudgeConfigured: () => judge instanceof HttpInstantEvalJudgeChannel,
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
      finish: (input) => finishes.finish(input),
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

  private static repositoriesOf(setup: InstantEvalSetup): InstantEvalRepositories {
    const clickhouse = setup.members.clickhouse;
    const resolveClient: InstantEvalClickHouseResolver = (tenantId) =>
      Promise.resolve(new ClickHouseMemberSession(clickhouse, tenantId));
    return ClickHouseInstantEvalRepositories.create({ resolveClient });
  }

  /**
   * Fail-safe rather than fail-closed: no key means the memory judge, which
   * skips every question instead of refusing every query, so a self-hosted
   * install sees the eval functions unavailable rather than broken.
   */
  private static judgeOf(
    setup: InstantEvalSetup,
    apiKey: string | undefined,
  ): InstantEvalJudgeChannel {
    if (setup.config.classifier === "null" || !apiKey) {
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

  async findRunProgress(input: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<InstantEvalRunProgress[]> {
    return this.reads.findRunProgress(input);
  }
}
