import { AnalyticsApi, type LangWatchQLRunCaller } from "@langwatch/analytics-contract";
import type { Actor } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
import { EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import {
  type ExplorerInstantEvalProgress,
  type ExplorerInstantEvalRunInput,
  type ExplorerSearchClassification,
  type ExplorerSearchClassificationInput,
  type InstantEvalActor,
  type InstantEvalApi as InstantEvalApiContract,
  InstantEvalApi,
  type InstantEvalRunInput,
  type InstantEvalJudgmentStatus,
  type InstantEvalEstimateWire,
  type InstantEvalOptInAccess,
  type InstantEvalQueryJudging,
  type InstantEvalQueryJudgingInput,
  type InstantEvalResultsWire,
  type InstantEvalSampleWire,
  type InstantEvalRunProgress,
  type InstantEvalUsageCount,
  type InstantEvalRunWire,
  type InstantEvalServerConfig,
  instantEvalConfig,
  isInstantEvalBounded,
} from "@langwatch/instant-eval-contract";
import {
  type InstantEvalClassifierLimits,
  type InstantEvalJudgement,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";

import type { InstantEvalJudgeChannel } from "../channels/instant-eval-judging.channel.ts";
import type { InstantEvalChannels } from "../channels/instant-eval.channels.ts";
import {
  DeterministicInstantEvalJudgeChannel,
  MemoryInstantEvalJudgeChannel,
} from "../channels/memory/memory.instant-eval-judging.channel.ts";
import type { InstantEvalRunExecutor } from "../eventing/instant-eval-processing.intent.ts";
import {
  InstantEvalProcessingPipelineAdapter,
  type InstantEvalProcessingPipelineDefinition,
} from "../eventing/instant-eval-processing.pipeline.ts";
import { InstantEvalRunProjectionStore } from "../eventing/instant-eval-run.store.ts";
import type { InstantEvalCancellationRepository } from "../repositories/instant-eval-cancellation.repository.ts";
import type { InstantEvalRepositories } from "../repositories/instant-eval.repositories.ts";
import {
  toExplorerRunInput,
  toExplorerRunProgress,
} from "../rules/instant-eval-explorer-run.rules.ts";
import {
  type InstantEvalJudgeKind,
  instantEvalJudgeKind,
  instantEvalJudgeRoute,
  isInstantEvalJudgeChosenOnFirstCall,
} from "../rules/instant-eval-judge-choice.rules.ts";
import {
  toInstantEvalEstimateWire,
  toInstantEvalJudgmentWire,
  toInstantEvalRunWire,
} from "../rules/instant-eval-wire.rules.ts";
import { InstantEvalAccessService } from "../services/instant-eval-access.service.ts";
import { InstantEvalCancelService } from "../services/instant-eval-cancel.service.ts";
import { InstantEvalClassifySearchService } from "../services/instant-eval-classify-search.service.ts";
import { InstantEvalClassifyService } from "../services/instant-eval-classify.service.ts";
import { InstantEvalCloudJudgeService } from "../services/instant-eval-cloud-judge.service.ts";
import { InstantEvalCommandDispatcherService } from "../services/instant-eval-command-dispatcher.service.ts";
import { InstantEvalConnectJudgeService } from "../services/instant-eval-connect-judge.service.ts";
import { InstantEvalCreateService } from "../services/instant-eval-create.service.ts";
import {
  InstantEvalEstimateService,
  type InstantEvalTextSource,
} from "../services/instant-eval-estimate.service.ts";
import { InstantEvalFinishService } from "../services/instant-eval-finish.service.ts";
import { InstantEvalFreeBudgetService } from "../services/instant-eval-free-budget.service.ts";
import { InstantEvalJudgeChoiceService } from "../services/instant-eval-judge-choice.service.ts";
import { InstantEvalJudgePageService } from "../services/instant-eval-judge-page.service.ts";
import { InstantEvalJudgeRowsService } from "../services/instant-eval-judge-rows.service.ts";
import {
  type InstantEvalJudgeSpendCatchUp,
  InstantEvalJudgeSpendCatchUpService,
} from "../services/instant-eval-judge-spend-catch-up.service.ts";
import { InstantEvalJudgedSpendService } from "../services/instant-eval-judged-spend.service.ts";
import { InstantEvalOptInService } from "../services/instant-eval-opt-in.service.ts";
import { InstantEvalPlanService } from "../services/instant-eval-plan.service.ts";
import { InstantEvalQueryJudgingService } from "../services/instant-eval-query-judging.service.ts";
import { InstantEvalReadsService } from "../services/instant-eval-reads.service.ts";
import { InstantEvalRowSourceService } from "../services/instant-eval-row-source.service.ts";
import { InstantEvalRunContextService } from "../services/instant-eval-run-context.service.ts";
import { InstantEvalRunService } from "../services/instant-eval-run.service.ts";
import { InstantEvalSampleService } from "../services/instant-eval-sample.service.ts";
import {
  InstantEvalSpendService,
  type InstantEvalSpendPeers,
} from "../services/instant-eval-spend.service.ts";
import { InstantEvalStatementService } from "../services/instant-eval-statement.service.ts";
import { InstantEvalTraceProofService } from "../services/instant-eval-trace-proof.service.ts";
import type { InstantEvalBrowserApi } from "../transport/instant-eval.trpc.ts";

/** The project's organization and team, which every judgement's spend is billed against. */
function spendAttributionOf(
  projects: Pick<ProjectApi, "findWithTeam">,
): InstantEvalSpendPeers["findSpendAttribution"] {
  return async ({ projectId }) => {
    const project = await projects.findWithTeam(projectId);

    return project
      ? { organizationId: project.team.organizationId, teamId: project.team.id }
      : undefined;
  };
}

type InstantEvalDependencies = Readonly<{
  featureFlags: typeof FeatureFlagApi;
  /** The query door: every statement is validated, run and extracted by it. */
  analytics: typeof AnalyticsApi;
  /** The plan that decides a run's row cap and whether the budget binds it. */
  plans: typeof EntitlementApi;
  /** The ledger a run's $1 check reads, and the spine a hosted call's spend is filed on. */
  gateway: typeof GatewayApi;
  /** The query door: a filtered shorthand target resolves its trace ids here. */
  traces: typeof TraceApi;
  /** Owns the organization's own Instant Evals consent (main #8348). */
  organizations: typeof OrganizationApi;
  /** Asks whether a member may throw the organization's switch, as `enable` declares. */
  authz: typeof AuthzApi;
}>;

type InstantEvalSetup = FeatureSetup<
  InstantEvalDependencies,
  InstantEvalServerConfig,
  InstantEvalRepositories,
  InstantEvalChannels
>;

export class InstantEvalModule implements InstantEvalApiContract, InstantEvalBrowserApi {
  static readonly contract = InstantEvalApi;
  static readonly dependencies = {
    featureFlags: FeatureFlagApi,
    analytics: AnalyticsApi,
    plans: EntitlementApi,
    gateway: GatewayApi,
    traces: TraceApi,
    organizations: OrganizationApi,
    authz: AuthzApi,
  };
  static readonly config = instantEvalConfig;

  private readonly access: InstantEvalAccessService;
  private readonly optIns: InstantEvalOptInService;
  private readonly classifications: InstantEvalClassifyService;
  private readonly searchClassifications: InstantEvalClassifySearchService;
  private readonly reads: InstantEvalReadsService;
  private readonly runs: InstantEvalRunService;
  private readonly dispatcher: InstantEvalCommandDispatcherService;
  private readonly pipeline: InstantEvalProcessingPipelineDefinition;
  private readonly hostedSpend: InstantEvalSpendService;
  private readonly queries: InstantEvalQueryJudgingService;
  private readonly spendCatchUp: InstantEvalJudgeSpendCatchUpService;

  private constructor(options: {
    access: InstantEvalAccessService;
    optIns: InstantEvalOptInService;
    classifications: InstantEvalClassifyService;
    searchClassifications: InstantEvalClassifySearchService;
    reads: InstantEvalReadsService;
    runs: InstantEvalRunService;
    dispatcher: InstantEvalCommandDispatcherService;
    pipeline: InstantEvalProcessingPipelineDefinition;
    hostedSpend: InstantEvalSpendService;
    queries: InstantEvalQueryJudgingService;
    spendCatchUp: InstantEvalJudgeSpendCatchUpService;
  }) {
    this.access = options.access;
    this.optIns = options.optIns;
    this.classifications = options.classifications;
    this.searchClassifications = options.searchClassifications;
    this.reads = options.reads;
    this.runs = options.runs;
    this.dispatcher = options.dispatcher;
    this.pipeline = options.pipeline;
    this.hostedSpend = options.hostedSpend;
    this.queries = options.queries;
    this.spendCatchUp = options.spendCatchUp;
  }

  static async create(setup: InstantEvalSetup): Promise<InstantEvalModule> {
    const repositories = setup.repositories;
    const judge = InstantEvalModule.judgeOf(setup);
    setup.resources.own("Instant Evals judge", () => judge.close?.() ?? Promise.resolve());

    const { analytics, plans, gateway, traces } = setup.dependencies;
    const { projects } = setup.channels;
    const access = InstantEvalAccessService.create({
      flags: setup.dependencies.featureFlags,
      projects,
      // Off cloud the judge never holds a key (ADR-174 d. 14): the key-less kind is exact.
      judgesThroughConnect:
        !setup.config.isSaas &&
        instantEvalJudgeKind({
          classifier: setup.config.classifier,
          hasCloudKey: false,
          isProduction: setup.config.nodeEnvironment === "production",
        }) === "connect",
      optIns: {
        isOptedIn: (organizationId) =>
          setup.dependencies.organizations.isInstantEvalsOptedIn({ organizationId }),
      },
      isJudgeConfigured: () => setup.config.classifier !== "null",
      judge,
    });
    const optIns = InstantEvalModule.optInsOf({ setup, access });
    const reads = InstantEvalReadsService.create({
      runs: repositories.runs,
      judgments: repositories.judgments,
    });
    const dispatcher = InstantEvalCommandDispatcherService.create();
    const rowSource = InstantEvalRowSourceService.create({ analytics });
    // The extraction half of a judged plan, which is Analytics' own: this
    // module judges the texts it answers with and never the rows behind them.
    const textSource: InstantEvalTextSource = {
      texts: (input) => analytics.hydrateLangWatchQLTexts(input),
    };
    const cancellations = repositories.cancellations;
    // A hold one process keeps to itself admits the same organization's runs
    // on every other, so a bounded budget refuses a process-local store.
    const isBounded = isInstantEvalBounded(setup.config);
    if (isBounded && setup.tier !== "live") {
      throw new Error(
        "Instant Evals with a bounded free budget (INSTANT_EVAL_BOUNDED, on by default when IS_SAAS) needs a Redis connection for the budget holds, and this process has none; set INSTANT_EVAL_BOUNDED=false to run unbounded",
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
      reservations: repositories.budgetReservations,
      isBounded,
    });
    const context = InstantEvalRunContextService.create({
      runs: repositories.runs,
      peers: {
        findProjectCaller: (input) => analytics.resolveApiKeyRunCaller(input),
        resolveProjectProtections: (input) => analytics.resolveProjectProtections(input),
        isQueryIdentityAvailable: () => analytics.isLangWatchQLAvailable(),
      },
    });

    // Main's hosted-call recorder: always the spend spine and never a log line, because an
    // unmetered hosted call is usage given away; the caller keeps the spend and retries.
    const hostedSpend = InstantEvalSpendService.create({
      peers: {
        findSpendAttribution: spendAttributionOf(projects),
        recordPricedSpend: async (input) => {
          const { status } = await gateway.recordPricedSpend(input);
          if (status === "unavailable") {
            throw new Error("the gateway spend pipeline is not registered");
          }
        },
      },
    });

    // A query's and a run's spend go through the Instant Evals judge, whose priced fact writes
    // the gateway ledger row (ADR-174 decision 13), under the organization resolved here.
    const judgedSpend = InstantEvalJudgedSpendService.create({
      peers: {
        findOrganizationId: ({ projectId }) => projects.findOrganizationId(projectId),
        judges: setup.channels.judges,
      },
    });
    const queries = InstantEvalQueryJudgingService.create({
      rows: InstantEvalJudgeRowsService.create({ judge }),
      budget,
      spend: judgedSpend,
      pricing: judge.pricing,
      queryTokenBudget: setup.config.queryTokenBudget,
    });

    const classifications = InstantEvalClassifyService.create({ judge });
    return new InstantEvalModule({
      hostedSpend,
      queries,
      spendCatchUp: InstantEvalJudgeSpendCatchUpService.create({
        peers: {
          listProjectIds: ({ organizationId }) =>
            projects.listIdsByOrganization({ organizationId }),
          ledger: gateway,
          judges: setup.channels.judges,
        },
      }),
      access,
      optIns,
      classifications,
      searchClassifications: InstantEvalClassifySearchService.create({
        classifications,
        peers: {
          isReleased: (input) => access.isReleased(input),
          traces,
          proofs: InstantEvalTraceProofService.create({ authz: setup.dependencies.authz }),
        },
      }),
      reads,
      runs: InstantEvalRunService.create({
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
          proofs: InstantEvalTraceProofService.create({ authz: setup.dependencies.authz }),
        },
        peers: {
          compileFilter: (input) => traces.compileLangWatchQLTraceFilter(input),
          selectTraceIds: (input) => traces.findTraceIdsForFilter(input),
          isEnabled: (input) => access.isEnabled(input),
          isReleased: (input) => access.isReleased(input),
          isQueryIdentityAvailable: () => analytics.isLangWatchQLAvailable(),
          resolveCaller: (input) => InstantEvalModule.callerOf({ analytics, ...input }),
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
      pipeline: InstantEvalProcessingPipelineAdapter.create({
        instantEvalRunStore: InstantEvalRunProjectionStore.create({ runs: repositories.runs }),
        dispatch: {
          executor: InstantEvalModule.executorOf({
            context,
            rowSource,
            textSource,
            judge,
            judgments: repositories.judgments,
            cancellations,
            budget,
            analytics,
            judgedSpend,
          }),
          commands: () => dispatcher.outcomeCommands(),
        },
      }),
    });
  }

  /** The offer and the switch, each peer narrowed to the one question it answers. */
  private static optInsOf({
    setup,
    access,
  }: {
    setup: InstantEvalSetup;
    access: InstantEvalAccessService;
  }): InstantEvalOptInService {
    const { plans, organizations, authz } = setup.dependencies;
    const { projects, licensing } = setup.channels;

    return InstantEvalOptInService.create({
      peers: {
        findOrganizationId: (projectId) => projects.findOrganizationId(projectId),
        isSaas: () => setup.config.isSaas,
        judgeRoute: async () => {
          const kind = await InstantEvalModule.kindOf(setup);
          return instantEvalJudgeRoute({
            kind,
            isConnectPermitted:
              kind === "connect" && (await licensing.getConnectDeployment()).permitted,
          });
        },
        licenseStateOf: (organizationId) =>
          licensing.getConnectServiceState({ organizationId, service: "instant_evals" }),
        isEnterprisePlan: async (organizationId) =>
          isEnterpriseTier((await plans.getActivePlan({ organizationId })).type),
        mayManageOrganization: ({ userId, organizationId }) =>
          authz.can({
            principal: { type: "user", id: userId },
            permission: "organization:manage",
            scope: { type: "organization", id: organizationId },
          }),
        isReleased: (input) => access.isReleased(input),
        recordOptIn: (input) => organizations.recordInstantEvalsOptIn(input),
      },
    });
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
    judgedSpend,
  }: {
    context: InstantEvalRunContextService;
    rowSource: InstantEvalRowSourceService;
    textSource: InstantEvalTextSource;
    judge: InstantEvalJudgeChannel;
    judgments: InstantEvalRepositories["judgments"];
    cancellations: InstantEvalCancellationRepository;
    budget: InstantEvalFreeBudgetService;
    analytics: AnalyticsApi;
    judgedSpend: InstantEvalJudgedSpendService;
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
      spend: judgedSpend,
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

  /** The spend catch-up for one organization, for its hand-run task (ADR-174 decision 17). */
  copyLedgerSpendToJudge(input: {
    organizationId: string;
    signal?: AbortSignal;
    isDryRun?: boolean;
  }): Promise<InstantEvalJudgeSpendCatchUp> {
    return this.spendCatchUp.copyLedgerSpend(input);
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
   * The judge `instantEvalJudgeKind` names; `none` skips every question, refusing none. Where the
   * key decides, the choice waits for the first call: the key is the Instant Evals judge's.
   */
  private static judgeOf(setup: InstantEvalSetup): InstantEvalJudgeChannel {
    const { classifier } = setup.config;
    const isProduction = setup.config.nodeEnvironment === "production";
    const connect = () =>
      InstantEvalConnectJudgeService.create({
        licensing: setup.channels.licensing,
        projects: setup.channels.projects,
      });
    if (isInstantEvalJudgeChosenOnFirstCall({ classifier })) {
      const { judges } = setup.channels;
      return InstantEvalJudgeChoiceService.create({
        choose: async () => {
          const kind = await InstantEvalModule.kindOf(setup);
          return kind === "cloud" ? InstantEvalCloudJudgeService.create({ judges }) : connect();
        },
      });
    }
    const kind = instantEvalJudgeKind({ classifier, hasCloudKey: false, isProduction });
    if (kind === "none") return MemoryInstantEvalJudgeChannel.create();
    if (kind === "memory") return DeterministicInstantEvalJudgeChannel.create();
    return connect();
  }

  /** The kind the judge resolves to; only a key-decided setting asks the Instant Evals judge. */
  private static async kindOf(setup: InstantEvalSetup): Promise<InstantEvalJudgeKind> {
    const { classifier } = setup.config;
    const hasCloudKey =
      isInstantEvalJudgeChosenOnFirstCall({ classifier }) &&
      (await setup.channels.judges.isClassifierConfigured());
    return instantEvalJudgeKind({
      classifier,
      hasCloudKey,
      isProduction: setup.config.nodeEnvironment === "production",
    });
  }

  async isEnabled(input: { projectId: string }): Promise<boolean> {
    return this.access.isEnabled(input);
  }

  async isReleased(input: { projectId: string }): Promise<boolean> {
    return this.access.isReleased(input);
  }

  getOptInAccess(input: { projectId: string; userId: string }): Promise<InstantEvalOptInAccess> {
    return this.optIns.getAccess(input);
  }

  optIn(input: { projectId: string; userId: string }): Promise<InstantEvalOptInAccess> {
    return this.optIns.optIn(input);
  }

  instantEvals(): InstantEvalApiContract {
    return this;
  }

  estimateExplorerRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<InstantEvalEstimateWire> {
    return this.estimateRun({
      projectId: input.request.projectId,
      actor: { kind: "member", userId: input.userId },
      input: toExplorerRunInput(input.request),
    });
  }

  async startExplorerRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<ExplorerInstantEvalProgress> {
    const run = await this.createRun({
      projectId: input.request.projectId,
      actor: { kind: "member", userId: input.userId },
      input: toExplorerRunInput(input.request),
    });

    return toExplorerRunProgress(run);
  }

  async cancelExplorerRun(input: {
    projectId: string;
    runId: string;
    requestedByUserId: string;
  }): Promise<ExplorerInstantEvalProgress> {
    return toExplorerRunProgress(await this.cancelRun(input));
  }

  async getExplorerRun(input: {
    projectId: string;
    runId: string;
  }): Promise<ExplorerInstantEvalProgress> {
    return toExplorerRunProgress(await this.getRun(input));
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

  classifySearch(
    input: ExplorerSearchClassificationInput & { actor: Actor },
  ): Promise<ExplorerSearchClassification> {
    return this.searchClassifications.classifySearch(input);
  }

  async classify(input: {
    projectId: string;
    text: string;
    questions: readonly InstantEvalQuestion[];
    signal?: AbortSignal;
  }): Promise<InstantEvalJudgement> {
    return this.classifications.classify(input);
  }

  judgeQuery(input: InstantEvalQueryJudgingInput): Promise<InstantEvalQueryJudging> {
    return this.queries.judgeQuery(input);
  }

  getJudgeLimits(): InstantEvalClassifierLimits {
    return this.classifications.getJudgeLimits();
  }

  priceOf(input: { inputTokens: number }): { costUsd: number; priceUsd: number } {
    return this.classifications.priceOf(input);
  }

  recordSpendForHostedCalls(input: {
    projectId: string;
    virtualKeyId: string;
    inputTokens: number;
    requests: number;
    costUsd: number;
    priceUsd: number;
    occurredAt: Instant;
  }): Promise<void> {
    return this.hostedSpend.recordSpend(input);
  }
}
