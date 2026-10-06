import { AgentApi, INSTANCE_TOKEN_HEADER } from "@langwatch/agent-contract";
import type { ProtocolConnection } from "@langwatch/api";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import type { RestIdentity } from "@langwatch/api/hosting";
import { BearerIdentity, SessionKeyIdentity } from "@langwatch/api/rest";
import type { SessionKeyHolder, SessionKeyPresented } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { EventingParticipation, StaticPipelineDefinition } from "@langwatch/eventing";
import { ExperimentApi } from "@langwatch/experiment-contract";
/**
 * The Langy feature's application: what its doors call. It holds every service and process
 * capability the feature's api files reach, and it is the one typed thing a transport is given.
 */
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { GithubApi } from "@langwatch/github-contract";
import {
  type LangyConversationDetail,
  type LangyConversationEventPage,
  type LangyConversationListPage,
  type LangyControlFramesInput,
  type LangyControlPollInput,
  type LangyControlRegisterInput,
  type LangyControlRegistered,
  type PlatformFrame,
  type LangyCredentialSession,
  type LangyEgressAllowlist,
  type LangyMessageRow,
  type LangyLocalRecord,
  type LangyMessagePart,
  type LangyMessageRole,
  LangyApi,
  type LangyApi as LangyApiContract,
  type LangyGetPageInput,
  type LangyGetEventsAfterInput,
  type LangyFindByIdVisibleInput,
  type LangyGetAllByConversationInput,
  type LangyDeleteByIdInput,
  type LangyUpdateByIdInput,
  type LangyForkByIdInput,
  type LangyWarmConversationWorkerInput,
  type LangyRevokeWorkerSessionKeyInput,
  type LangyTurnExistsInput,
  type LangyFindRunTokenInput,
  type LangyRecordToolCallStartedInput,
  type LangyRecordToolCallCompletedInput,
  type LangyRecordTurnHandoffInput,
  type LangyRecordPlanUpdatedInput,
  type LangyTurnSettlementWait,
  type LangyTurnSettlementWaitInput,
  assertLangyServerConfig,
  langyConfig,
  langySecrets,
  renderLangyTurnContext,
  type LangyServerConfig,
  type LangyUsageCount,
  type LangyRelayConnection,
  type LocalControlConnectCredentials,
  type RelayTally,
  type LangyConversationDetailDto,
  type LangyConversationEventPageDto,
  type LangyConversationListPageDto,
  type LangyConversationMessagesDto,
  type LangyPanelCall,
  type LangyStreamEntry,
  type langyAnswerLocalPermissionInputSchema,
  type langyAnswerQuestionInputSchema,
  type langyClaimUiActionInputSchema,
  type langyCompleteUiActionInputSchema,
  type langyContinueConversationInputSchema,
  type langyConversationUpdateFrameSchema,
  type langyEgressGetInputSchema,
  type langyEgressSetInputSchema,
  type langyEgressStateSchema,
  type langyEventsAfterInputSchema,
  type langyFeedbackPromptShownInputSchema,
  type langyForkInputSchema,
  type langyListInputSchema,
  type langyLocalWorkspaceStatusSchema,
  type langyPanelConversationInputSchema,
  type langyPanelCreateConversationInputSchema,
  type langyProjectInputSchema,
  type langyRecordFeedbackInputSchema,
  type langyRenameInputSchema,
  type langySetCodeAccessPreferenceInputSchema,
  type langySetLocalPolicyInputSchema,
  type langyStopTurnPanelInputSchema,
  type langyTurnStreamInputSchema,
  type langyWarmWorkerInputSchema,
} from "@langwatch/langy-contract";
import type * as langyContractModule from "@langwatch/langy-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import { OnboardingApi } from "@langwatch/onboarding-contract";
import { PresenceApi } from "@langwatch/presence-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { SecretApi } from "@langwatch/secret-contract";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
import type { z } from "zod";

import { HttpLangyWorkerChannel } from "../channels/http/http.langy-worker.channel.ts";
import type { LangyWorker } from "../channels/langy-worker.channel.ts";
import { UnavailableLangyWorkerChannel } from "../channels/unavailable.langy-worker.channel.ts";
import { RedisLangyConversationProducerRepository } from "../eventing/langy-conversation-producer.pipeline.ts";
import { EventingLangyConversationAdapter } from "../eventing/langy-conversation-runtime.pipeline.ts";
import { LangyConversationCommandSenders } from "../eventing/langy-conversation.commands.ts";
import type { LangyConversationCommands } from "../eventing/langy-conversation.commands.ts";
import type { LangyConversationDefinition } from "../eventing/langy-conversation.pipeline.ts";
import { buildLangyMaintenancePipeline } from "../eventing/langy-maintenance.pipeline.ts";
import type { LangySessionKeyReapDeps } from "../eventing/langy-session-key-reap.intent.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import { RedisLangyTurnRelayRepository } from "../repositories/redis/redis.langy-turn-relay.repository.ts";
import { readSessionKeyCredential } from "../rules/langy-local-control-connect.rules.ts";
import { langyWorkerRuntimeOf } from "../rules/langy-worker-runtime.rules.ts";
import { LangyAnalyticsEventStorageService } from "../services/langy-analytics-event-storage.service.ts";
import { LangyBlockMetricsOtelService } from "../services/langy-block-metrics-otel.service.ts";
import { LangyConversationUpdateService } from "../services/langy-conversation-update.service.ts";
import { LangyGithubPrPermitService } from "../services/langy-github-pr-permit.service.ts";
import {
  LANGY_GITHUB_PRS_PER_DAY,
  LangyGithubPrQuotaService,
} from "../services/langy-github-pr-quota.service.ts";
import { LangyGithubTurnTokenService } from "../services/langy-github-turn-token.service.ts";
import { LangyGuidedKickoffService } from "../services/langy-guided-kickoff.service.ts";
import { LangyGuidedOnboardingService } from "../services/langy-guided-onboarding.service.ts";
import { LangyInternalService } from "../services/langy-internal.service.ts";
import { LocalControlConnectionService } from "../services/langy-local-control-connection.service.ts";
import { LocalControlLongPollService } from "../services/langy-local-control-long-poll.service.ts";
import { LangyLocalControlRuntimeService } from "../services/langy-local-control-runtime.service.ts";
import type { LocalControlRuntime } from "../services/langy-local-control-runtime.service.ts";
import { LangyLocalControlTerminalService } from "../services/langy-local-control-terminal.service.ts";
import { LocalControlSessionCoreService } from "../services/langy-local-session.service.ts";
import { LangyLocalWorkerService } from "../services/langy-local-worker.service.ts";
import { LangyLocalWorkspaceService } from "../services/langy-local-workspace.service.ts";
import { LangyModelService } from "../services/langy-model.service.ts";
import { LangyNavigateFallbackService } from "../services/langy-navigate-fallback.service.ts";
import { LangyNavigateResourceLocatorService } from "../services/langy-navigate-resource-locator.service.ts";
import { LangyPanelAccessService } from "../services/langy-panel-access.service.ts";
import { LangyPanelConversationService } from "../services/langy-panel-conversation.service.ts";
import { LangyPanelEgressService } from "../services/langy-panel-egress.service.ts";
import { LangyPanelLocalService } from "../services/langy-panel-local.service.ts";
import {
  LangyPostgresService,
  type LangyServiceCompositionOptions,
} from "../services/langy-postgres.service.ts";
import { LangyRestCallerService } from "../services/langy-rest-caller.service.ts";
import { LangyRestMetricsPrometheusService } from "../services/langy-rest-metrics-prometheus.service.ts";
import { LangySessionKeyMetricsOtelService } from "../services/langy-session-key-metrics-otel.service.ts";
import { LangySessionKeyReapService } from "../services/langy-session-key-reap.service.ts";
import type { LangySessionKeyService } from "../services/langy-session-key.service.ts";
import { LangySkillGatesService } from "../services/langy-skill-gates.service.ts";
import { LangyTitleGeneratorService } from "../services/langy-title-generator.service.ts";
import { LangyTurnSettlementWaiterService } from "../services/langy-turn-settlement-waiter.service.ts";
import { LangyTurnsBoundsService } from "../services/langy-turns-bounds.service.ts";
import { LangyUiActionBackendService } from "../services/langy-ui-action-backend.service.ts";
import { LangyUiActionCatalogService } from "../services/langy-ui-action-catalog.service.ts";
import { LangyUiActionDoorService } from "../services/langy-ui-action-door.service.ts";
import { LangyUiActionExperimentBackendService } from "../services/langy-ui-action-experiment-backend.service.ts";
import { LangyUiActionPageService } from "../services/langy-ui-action-page.service.ts";
import { LangyUiActionSurfaceService } from "../services/langy-ui-action-surface.service.ts";
import { LangyUiActionService } from "../services/langy-ui-action.service.ts";
import { LangyVirtualKeyGatewayService } from "../services/langy-virtual-key-gateway.service.ts";
import { LangyVirtualKeyProvisioningService } from "../services/langy-virtual-key-provisioning.service.ts";
import { LangyWorkerMetricsOtelService } from "../services/langy-worker-metrics-otel.service.ts";
import type { LangyService, OpenLangyRelay } from "../services/langy.service.ts";
import { SetupSkillsService } from "../services/setup-skills.service.ts";

const relayLogger = createLogger("langwatch:langy:relay");

/** What the process composes this feature's application from. */
type LangyAppDependencies = {
  langy: LangyService;
  internalDoor: RestIdentity;
  /** The rows the module keeps outside its event log, chosen at boot. */
  repositories: LangyRepositories;
  /**
   * The SAME per-tenant fabric presence publishes on, reached through its
   * module API: both live channels ride one emitter per tenant rather
   * than a second of their own.
   */
  presence: PresenceApi;
  /** The per-project window every turn is counted against before it dispatches. */
  turnBounds: LangyTurnsBoundsService;
  virtualKeyProvisioning: LangyVirtualKeyProvisioningService;
  /** The maintenance sweep's own service: no aggregate, no commands, just the reap. */
  sessionKeyReap: LangySessionKeyReapService;
  /** The rollout gate and key-owner bridge every key-authenticated door runs. */
  callers: LangyRestCallerService;
  uiActionDoor: LangyUiActionDoorService;
  /** What the local doors reach beyond `LangyApi` (ADR-129). */
  localControl: LangyLocalControl;
  localWorker: LangyLocalWorkerService;
  localControlTerminal: LangyLocalControlTerminalService;
  /** This process's long-poll shares, over the one session core. */
  longPoll: LocalControlLongPollService;
  sockets: LocalControlConnectionService;
  sessionKeyDoor: RestIdentity;
  panelConversations: LangyPanelConversationService;
  panelLocal: LangyPanelLocalService;
  panelEgress: LangyPanelEgressService;
  /** The pipeline's senders, bound once the process registers it (§9). */
  conversationCommands: LangyConversationCommandSenders;
  /** The consume half of the pipeline: its folds, process manager and reactions. */
  conversationProcessing: EventingLangyConversationAdapter;
};

/** The local-control runtime, its durable commands, its peer reads and this origin. */
export interface LangyLocalControl {
  runtime: LocalControlRuntime;
  commands: LangyConversationCommands;
  workspace: LangyLocalWorkspaceService;
  baseHost: string | undefined;
}

type LangySetup = FeatureSetup<
  typeof LangyModule.dependencies,
  never,
  LangyServerConfig,
  LangyRepositories
>;

export class LangyModule implements LangyApiContract {
  static readonly contract: typeof LangyApi = LangyApi;
  /**
   * presence: same per-tenant fabric. featureFlags: deployment rollout store
   * the key-authenticated doors' rollout gate and owner bridge read.
   */
  static readonly dependencies = {
    presence: PresenceApi,
    featureFlags: FeatureFlagApi,
    /** The project→organization hop the turn window resolves through. */
    projects: ProjectApi,
    /** The plan the turn window resolves through. */
    plans: EntitlementApi,
    /** The local doors' peer reads and the session key a control request mints. */
    users: UserApi,
    github: GithubApi,
    modelProviders: ModelProviderApi,
    apiKeys: ApiKeyApi,
    authz: AuthzApi,
    /** Langy's own gateway key: minted by the gateway, kept under a reserved project secret. */
    gateway: GatewayApi,
    secrets: SecretApi,
    /** The saved workbench an away page's UI action is applied to, and a navigate's experiment. */
    experiments: ExperimentApi,
    /** The agent a navigate with no remembered link opens, at the agent's own address. */
    agents: AgentApi,
    /** The resources a navigate with no remembered link opens, each looked up in its owner. */
    prompts: PromptApi,
    datasets: DatasetApi,
    workflows: WorkflowApi,
    monitors: MonitorApi,
    evaluators: EvaluatorApi,
    scenarios: ScenarioApi,
    /** Whether a failed turn belonged to guided onboarding, and where that failure is tracked. */
    onboarding: OnboardingApi,
    /** Where Langy's notifications are sent from: notification's Web Push. */
    notifications: NotificationService,
    /** The platform default retention the analytics grain is written on. */
    retention: DataRetentionApi,
  };
  static readonly config = langyConfig;
  static readonly secrets = langySecrets;

  static async create(setup: LangySetup): Promise<LangyModule> {
    const { channel, door, configured } = await setup.secrets.into(
      langySecrets.internal,
      (internalSecret) => {
        assertLangyServerConfig(setup.config, internalSecret);
        const metrics = LangyWorkerMetricsOtelService.create();
        const configured = Boolean(setup.config.agentUrl && internalSecret);
        const channel =
          setup.config.agentUrl && internalSecret
            ? HttpLangyWorkerChannel.create({
                agentUrl: setup.config.agentUrl,
                internalSecret,
                metrics,
              })
            : UnavailableLangyWorkerChannel.create(metrics);
        const door = BearerIdentity.create({ name: "langy-internal", token: internalSecret });
        return { channel, door, configured };
      },
    );
    const adapter = LangyPostgresService.create({
      repositories: setup.repositories,
    });
    const sessionKeys = adapter.createSessionKeys({
      apiKeys: setup.dependencies.apiKeys,
      authz: setup.dependencies.authz,
      metrics: LangySessionKeyMetricsOtelService.create(),
    });
    const built = LangyModule.#composeInfrastructure({
      setup,
      // Main's preset: no agent, no turn worker, so a send refuses "Agent not configured".
      worker: configured ? channel : null,
      sessionKeys,
    });
    const commands = LangyConversationCommandSenders.create();
    const langy = adapter.build({
      ...built,
      commands,
    });
    const workspace = LangyLocalWorkspaceService.create({
      users: setup.dependencies.users,
      github: setup.dependencies.github,
      projects: setup.dependencies.projects,
      modelProviders: setup.dependencies.modelProviders,
    });
    const callers = LangyRestCallerService.create({
      featureFlags: setup.dependencies.featureFlags,
      actors: setup.dependencies.users,
      projects: setup.dependencies.projects,
    });
    const buffer = setup.repositories.tokenBuffer.open();
    const runtime = LangyLocalControlRuntimeService.create({
      store: setup.repositories.sessionState,
      presence: setup.repositories.localPresence,
      projects: workspace,
      mintSessionKey: (input) => sessionKeys.mintForUser(input),
      events: commands,
      buffer,
    });
    const core = LocalControlSessionCoreService.create({
      apiKeys: setup.dependencies.apiKeys,
      readCredential: readSessionKeyCredential,
      actors: setup.dependencies.users,
      baseHost: setup.config.publicBaseUrl,
      store: runtime.store,
      presence: runtime.presence,
      dispatcher: runtime.dispatcher,
      waits: runtime.waits,
      requests: runtime.requests,
      turns: LocalControlSessionCoreService.turnStarter({
        actors: setup.dependencies.users,
        turns: langy,
      }),
      conversations: langy,
      events: commands,
      buffer,
      skipGate: (gate) => workspace.canSkipPermissions(gate),
    });
    const persistence = adapter.eventing();
    const guidedOnboarding = LangyGuidedOnboardingService.create({
      onboarding: setup.dependencies.onboarding,
    });
    const conversationProcessing = EventingLangyConversationAdapter.create({
      langyConversationProjectionStore: persistence.langyConversationState,
      langyConversationTurnProjectionStore: persistence.langyConversationTurnState,
      langyMessageProjectionStore: persistence.langyMessageStorage,
      langyAnalyticsEventProjectionStore: LangyAnalyticsEventStorageService.create({
        sink: setup.repositories.analyticsEvents,
        defaultRetentionDays: () => setup.dependencies.retention.getPlatformDefaultRetentionDays(),
      }),
      retention: {
        resolve: (tenantId) =>
          setup.dependencies.retention.getResolvedForProject({ projectId: tenantId }),
      },
      broadcast: LangyConversationUpdateService.create({ presence: setup.dependencies.presence }),
      admissions: persistence.langyTurnAdmission,
      buffer,
      handoffStore: setup.repositories.turnHandoff,
      worker: channel,
      titleGenerator: LangyTitleGeneratorService.create({
        messages: persistence.trustedMessages,
        models: setup.dependencies.modelProviders,
      }).generator(),
      sessionKeys,
      localConnectTurn: {
        presence: () => runtime.presence,
        turns: LocalControlSessionCoreService.turnStarter({
          actors: setup.dependencies.users,
          turns: langy,
        }),
      },
      guidedOnboarding: { reader: guidedOnboarding, analytics: guidedOnboarding },
      webPush: {
        users: setup.dependencies.users,
        projects: setup.dependencies.projects,
        notifications: setup.dependencies.notifications,
      },
    });
    const longPoll = LocalControlLongPollService.create({ core });
    const sockets = LocalControlConnectionService.create({ core });
    setup.resources.own("Langy local-control session state", () =>
      setup.repositories.sessionState.close(),
    );
    setup.resources.own("Langy local-control long-poll sessions", () => longPoll.close());
    setup.resources.own("Langy local-control sockets", () => sockets.close());
    const sessionKeyDoor = SessionKeyIdentity.create({
      instanceTokenHeader: INSTANCE_TOKEN_HEADER,
      verify: (presented) => longPoll.verifySessionKey(presented),
    });
    const turnBounds = LangyTurnsBoundsService.create({
      entitlement: setup.dependencies.plans,
      projects: setup.dependencies.projects,
      rateLimits: setup.repositories.rateLimits,
    });
    const access = LangyPanelAccessService.create({
      featureFlags: setup.dependencies.featureFlags,
      projects: setup.dependencies.projects,
      authz: setup.dependencies.authz,
    });
    const catalog = LangyUiActionCatalogService.create();
    const uiActionDoor = LangyUiActionDoorService.create({
      callers,
      catalog,
      authz: setup.dependencies.authz,
      actions: LangyUiActionService.create({
        uiActions: setup.repositories.uiActions,
        conversations: { getById: (args) => langy.getById(args) },
        buffer: setup.repositories.tokenBuffer.open(),
        actions: catalog,
        backendRunner: LangyUiActionBackendService.create({
          backend: LangyUiActionExperimentBackendService.create({
            experiments: setup.dependencies.experiments,
            projects: setup.dependencies.projects,
          }),
          projects: setup.dependencies.projects,
        }).runner,
      }),
    });
    return new LangyModule({
      langy,
      uiActionDoor,
      internalDoor: door,
      repositories: setup.repositories,
      presence: setup.dependencies.presence,
      turnBounds,
      virtualKeyProvisioning: LangyVirtualKeyProvisioningService.create({
        virtualKeys: built.credentials.virtualKeys,
      }),
      sessionKeyReap: LangySessionKeyReapService.create({
        repository: setup.repositories.sessionKeyReap,
        metrics: LangySessionKeyMetricsOtelService.create(),
      }),
      callers,
      localControl: { runtime, commands, workspace, baseHost: setup.config.publicBaseUrl },
      localWorker: LangyLocalWorkerService.create({
        runtime,
        commands,
        workspace,
        callers,
        conversations: langy,
        baseHost: setup.config.publicBaseUrl,
      }),
      localControlTerminal: LangyLocalControlTerminalService.create({
        requests: runtime.requests,
        permissions: setup.dependencies.authz,
        baseHost: setup.config.publicBaseUrl,
      }),
      longPoll,
      sockets,
      sessionKeyDoor,
      panelConversations: LangyPanelConversationService.create({
        access,
        langy,
        turnBounds,
        rateLimits: setup.repositories.rateLimits,
        presence: setup.dependencies.presence,
        turnAccess: setup.repositories.turnAccess,
        openBuffer: () => setup.repositories.tokenBuffer.openBlocking(),
        uiActions: LangyUiActionPageService.create({ uiActions: setup.repositories.uiActions }),
      }),
      panelLocal: LangyPanelLocalService.create({
        access,
        conversations: langy,
        runtime,
        commands,
        workspace,
        projects: setup.dependencies.projects,
        baseHost: setup.config.publicBaseUrl,
      }),
      panelEgress: LangyPanelEgressService.create({ access, langy }),
      conversationCommands: commands,
      conversationProcessing,
    });
  }

  /**
   * Everything `LangyPostgresService.build` needs besides `commands`: the turn's technical
   * collaborators, the worker credentials, block metrics, feedback prompts and the relay.
   */
  static #composeInfrastructure({
    setup,
    worker,
    sessionKeys,
  }: {
    setup: LangySetup;
    worker: LangyWorker | null;
    sessionKeys: LangySessionKeyService;
  }): Omit<LangyServiceCompositionOptions, "commands"> {
    const { config, dependencies, repositories } = setup;
    const { publicBaseUrl } = config;
    const navigateFallback = LangyNavigateFallbackService.create({
      projects: dependencies.projects,
      resources: LangyNavigateResourceLocatorService.create({
        experiments: dependencies.experiments,
        agents: dependencies.agents,
        prompts: dependencies.prompts,
        datasets: dependencies.datasets,
        workflows: dependencies.workflows,
        monitors: dependencies.monitors,
        evaluators: dependencies.evaluators,
        scenarios: dependencies.scenarios,
        publicBaseUrl,
      }),
      publicBaseUrl,
    });
    return {
      turns: {
        models: LangyModelService.create({ modelProviders: dependencies.modelProviders }),
        worker,
        tokenBuffer: repositories.tokenBuffer.open(),
        permits: LangyGithubPrPermitService.create(
          LangyGithubPrQuotaService.create({ counts: repositories.githubPrCounts }),
        ),
        perDayPrCap: LANGY_GITHUB_PRS_PER_DAY,
        sessionKeys,
        // Rendering the composer's context chips is pure, and the contract package owns it.
        context: { render: renderLangyTurnContext },
        uiActionSurface: LangyUiActionSurfaceService.create(dependencies.featureFlags),
        skillGates: LangySkillGatesService.create(dependencies.featureFlags),
        guidedKickoff: LangyGuidedKickoffService.create({ onboarding: dependencies.onboarding }),
        metrics: { count: () => undefined },
        accessStore: repositories.turnAccess,
        handoffStore: repositories.turnHandoff,
      },
      credentials: {
        sessionKeys,
        virtualKeys: LangyVirtualKeyGatewayService.create({
          secrets: dependencies.secrets,
          gateway: dependencies.gateway,
        }),
        github: LangyGithubTurnTokenService.create(dependencies.github),
        runtime: langyWorkerRuntimeOf({ config, publicBaseUrl }),
      },
      blockMetrics: LangyBlockMetricsOtelService.create(),
      feedbackPrompts: repositories.feedbackPrompts,
      openRelay: LangyModule.#relayOpener({
        repositories,
        baseHost: publicBaseUrl ?? "",
        navigateFallback,
      }),
    };
  }

  /**
   * One relay per pushed connection, as main's relay route built it: frames are
   * authenticated against the project-scoped handoff, deduplicated on the turn's
   * nonce set, fanned to the live buffer; an unremembered navigate falls back.
   */
  static #relayOpener({
    repositories,
    baseHost,
    navigateFallback,
  }: {
    repositories: LangyRepositories;
    baseHost: string;
    navigateFallback: LangyNavigateFallbackService;
  }): OpenLangyRelay {
    return (conversations) =>
      RedisLangyTurnRelayRepository.create({
        conversations,
        buffer: repositories.tokenBuffer.open(),
        frameDedup: repositories.frameDedup,
        handoff: repositories.turnHandoff,
        resourceLinks: repositories.resourceLinks,
        resolveResourceUrl: async (navigate) => {
          const resolution = await navigateFallback.resolveUrl(navigate);
          return resolution.outcome === "resolved" ? resolution.url : null;
        },
        baseHost,
        logger: relayLogger,
      });
  }

  /** langy_conversation_processing as this role registers it: the worker folds, the api sends. */
  conversationPipeline({
    participation,
  }: {
    participation: EventingParticipation;
  }): LangyConversationDefinition {
    if (participation === "produce") {
      return RedisLangyConversationProducerRepository.create({ processName: "langy" }).build();
    }
    return this.dependencies.conversationProcessing.buildProcessing();
  }

  /** The registration's senders, handed to every write and to the pipeline's own effects. */
  connectConversationCommands(commands: Readonly<Record<string, unknown>>): void {
    const senders = this.dependencies.conversationCommands;
    senders.connect(commands);
    this.dependencies.conversationProcessing.connectCommands({
      failAgentResponse: (data) => senders.failAgentResponse(data),
      generateConversationTitle: (data) => senders.generateConversationTitle(data),
    });
  }

  /**
   * The pipeline `langy_maintenance` registers (ADR-144), ported from the
   * deleted `LangyMaintenanceWorkerFeatureInstaller`. `deleteDispatchedBefore`
   * is the installing process's own outbox prune, handed in by the seam.
   */
  maintenanceEventingPipeline(
    deps: Pick<LangySessionKeyReapDeps, "deleteDispatchedBefore">,
  ): StaticPipelineDefinition<never> {
    return buildLangyMaintenancePipeline({
      sessionKeyReap: {
        reap: () => this.dependencies.sessionKeyReap.reap(),
        deleteDispatchedBefore: deps.deleteDispatchedBefore,
      },
      virtualKeyProvisioning: this.dependencies.virtualKeyProvisioning,
    });
  }

  get internalDoor(): RestIdentity {
    return this.dependencies.internalDoor;
  }

  /** The door the long-poll register authenticates its minted session key at (§8). */
  get sessionKeyDoor(): RestIdentity {
    return this.dependencies.sessionKeyDoor;
  }

  readonly #internal: LangyInternalService;
  readonly #setupSkills = SetupSkillsService.create();

  private constructor(private readonly dependencies: LangyAppDependencies) {
    this.#internal = LangyInternalService.create(
      dependencies.langy,
      LangyRestMetricsPrometheusService.create(),
    );
  }

  getRestCaller(
    input: langyContractModule.LangyRestCallerInput,
  ): Promise<langyContractModule.LangyRestCaller> {
    return this.dependencies.callers.getCaller(input);
  }

  listUiActions(
    input: langyContractModule.LangyKeyCaller,
  ): Promise<langyContractModule.LangyUiActionsListed> {
    return this.dependencies.uiActionDoor.list(input);
  }

  dispatchUiAction(
    input: langyContractModule.LangyUiActionDispatchInput,
  ): Promise<langyContractModule.LangyUiActionDispatched> {
    return this.dependencies.uiActionDoor.dispatch(input);
  }

  getRestActor(input: { userId: string }): Promise<LangyCredentialSession> {
    return this.dependencies.callers.getActor(input);
  }

  getLocalCaller(
    input: langyContractModule.LangyKeyCaller,
  ): Promise<langyContractModule.LangyLocalCaller> {
    return this.dependencies.callers.getLocalCaller(input);
  }

  getLocalWorkspace(
    input: langyContractModule.LangyLocalConversationInput,
  ): Promise<langyContractModule.WorkspaceStatus> {
    return this.dependencies.localWorker.getWorkspace(input);
  }

  createLocalControlRequest(
    input: langyContractModule.LangyLocalConversationInput,
  ): Promise<langyContractModule.CreateControlRequestResponse> {
    return this.dependencies.localWorker.createControlRequest(input);
  }

  startLocalCall(
    input: langyContractModule.LangyLocalStartCallInput,
  ): Promise<langyContractModule.StartCallResponse> {
    return this.dependencies.localWorker.startCall(input);
  }

  getLocalCallAnswer(
    input: langyContractModule.LangyLocalCallInput,
  ): Promise<langyContractModule.PollCallResponse> {
    return this.dependencies.localWorker.getCallAnswer(input);
  }

  cancelLocalCall(
    input: langyContractModule.LangyLocalCallInput,
  ): Promise<langyContractModule.LangyLocalCallCancelled> {
    return this.dependencies.localWorker.cancelCall(input);
  }

  startLocalWait(
    input: langyContractModule.LangyLocalStartWaitInput,
  ): Promise<langyContractModule.StartWaitResponse> {
    return this.dependencies.localWorker.startWait(input);
  }

  getLocalWaitAnswer(
    input: langyContractModule.LangyLocalWaitInput,
  ): Promise<langyContractModule.PollWaitResponse> {
    return this.dependencies.localWorker.getWaitAnswer(input);
  }
  listLocalControlRequests(
    input: langyContractModule.LangyControlOwnerInput,
  ): Promise<langyContractModule.ListControlRequestsResponse> {
    return this.dependencies.localControlTerminal.listRequests(input);
  }

  approveLocalControlRequest(
    input: langyContractModule.LangyControlRequestInput,
  ): Promise<langyContractModule.ApproveControlRequestResponse> {
    return this.dependencies.localControlTerminal.approveRequest(input);
  }

  cancelLocalControlRequest(
    input: langyContractModule.LangyControlRequestInput,
  ): Promise<langyContractModule.LangyControlRequestCancelled> {
    return this.dependencies.localControlTerminal.cancelRequest(input);
  }

  ingestInternalTurnResult(input: langyContractModule.LangyTurnResultInput): Promise<{
    status: "accepted";
  }> {
    return this.#internal.ingestTurnResult(input);
  }

  revokeInternalCredentials(input: { apiKeyId: string; projectId: string }): Promise<{
    outcome: "revoked" | "already_revoked";
  }> {
    return this.#internal.revokeCredentials(input);
  }

  receiveInternalFrames(body: ReadableStream<Uint8Array> | null): Promise<RelayTally> {
    return this.#internal.receiveFrames(body);
  }

  /** What the local doors reach beyond `LangyApi`. */
  verifyLocalControlSessionKey(presented: SessionKeyPresented): Promise<SessionKeyHolder> {
    return this.dependencies.longPoll.verifySessionKey(presented);
  }

  registerLocalControlSession(input: LangyControlRegisterInput): Promise<LangyControlRegistered> {
    return this.dependencies.longPoll.register(input);
  }

  pollLocalControlSession(input: LangyControlPollInput): Promise<{ frames: PlatformFrame[] }> {
    return this.dependencies.longPoll.poll(input);
  }

  postLocalControlFrames(input: LangyControlFramesInput): Promise<{ accepted: number }> {
    return this.dependencies.longPoll.frames(input);
  }

  acceptLocalControlConnection(
    connection: ProtocolConnection,
    credentials: LocalControlConnectCredentials,
  ): Promise<void> {
    return this.dependencies.sockets.accept(connection, credentials);
  }

  get localControl(): LangyLocalControl {
    return this.dependencies.localControl;
  }

  /** The rows this application persists outside its own event log. */
  get repositories(): LangyRepositories {
    return this.dependencies.repositories;
  }

  /**
   * The service itself, for the paths that are not a Langy door. Everything below serves a
   * person looking at a conversation.
   */
  get langyService(): LangyService {
    return this.dependencies.langy;
  }

  findEgressAllowlist(input: { projectId: string }): Promise<LangyEgressAllowlist | null> {
    return this.dependencies.langy.findEgressAllowlist(input);
  }

  openRelayConnection(): LangyRelayConnection {
    return this.dependencies.langy.openRelayConnection();
  }

  getPage(input: LangyGetPageInput): Promise<LangyConversationListPage> {
    return this.dependencies.langy.getPage(input);
  }

  getEventsAfter(input: LangyGetEventsAfterInput): Promise<LangyConversationEventPage> {
    return this.dependencies.langy.getEventsAfter(input);
  }

  findByIdVisible(input: LangyFindByIdVisibleInput): Promise<LangyConversationDetail | null> {
    return this.dependencies.langy.findByIdVisible(input);
  }

  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<LangyUsageCount> {
    return this.dependencies.langy.countUsage(input);
  }

  getSetupSkillPrompt(input: { projectId: string; skill: string }): Promise<{ body: string }> {
    return this.#setupSkills.getPrompt(input);
  }

  getAllByConversation(input: LangyGetAllByConversationInput): Promise<LangyMessageRow[]> {
    return this.dependencies.langy.getAllByConversation(input);
  }

  deleteById(input: LangyDeleteByIdInput): Promise<boolean> {
    return this.dependencies.langy.deleteById(input);
  }

  updateById(input: LangyUpdateByIdInput): Promise<LangyConversationDetail> {
    return this.dependencies.langy.updateById(input);
  }

  forkById(input: LangyForkByIdInput): Promise<{
    conversation: LangyConversationDetail;
  }> {
    return this.dependencies.langy.forkById(input);
  }

  /**
   * Counted before anything dispatches: one turn is agent work the project
   * pays for, so the project's window is spent here and an over-limit caller
   * never reaches the engine.
   */
  async startConversationTurn(input: langyContractModule.LangyStartConversationTurnInput): Promise<{
    conversationId: string;
    turnId: string;
  }> {
    await this.dependencies.turnBounds.assertTurnWithinBounds({ projectId: input.projectId });

    return this.dependencies.langy.startConversationTurn(input);
  }

  /** A `Prefer: wait` hold borrows its own blocking connection and gives it back on release. */
  awaitTurnSettlement(input: LangyTurnSettlementWaitInput): Promise<LangyTurnSettlementWait> {
    const { repositories } = this.dependencies;

    return LangyTurnSettlementWaiterService.create().awaitTurnSettlement({
      ...input,
      langy: this,
      openBuffer: () => repositories.tokenBuffer.openBlocking(),
    });
  }

  warmConversationWorker(input: LangyWarmConversationWorkerInput): Promise<{
    conversationId: string | null;
    warmed: boolean;
  }> {
    return this.dependencies.langy.warmConversationWorker(input);
  }

  findModelsAllowedForProject(projectId: string): Promise<string[] | null> {
    return this.dependencies.langy.findModelsAllowedForProject(projectId);
  }

  revokeWorkerSessionKey(
    input: LangyRevokeWorkerSessionKeyInput,
  ): Promise<"revoked" | "already_revoked" | "not_found" | "refused"> {
    return this.dependencies.langy.revokeWorkerSessionKey(input);
  }

  turnExists(input: LangyTurnExistsInput): Promise<boolean> {
    return this.dependencies.langy.turnExists(input);
  }

  ingestAgentTurnResult(input: langyContractModule.LangyTurnResultInput): Promise<void> {
    return this.dependencies.langy.ingestAgentTurnResult(input);
  }

  findRunToken(input: LangyFindRunTokenInput): Promise<string | null> {
    return this.dependencies.langy.findRunToken(input);
  }

  recordToolCallStarted(input: LangyRecordToolCallStartedInput): Promise<void> {
    return this.dependencies.langy.recordToolCallStarted(input);
  }

  recordToolCallCompleted(input: LangyRecordToolCallCompletedInput): Promise<void> {
    return this.dependencies.langy.recordToolCallCompleted(input);
  }

  recordTurnHandoff(input: LangyRecordTurnHandoffInput): Promise<void> {
    return this.dependencies.langy.recordTurnHandoff(input);
  }

  recordPlanUpdated(input: LangyRecordPlanUpdatedInput): Promise<void> {
    return this.dependencies.langy.recordPlanUpdated(input);
  }

  /** Writes one line into the transcript without starting a turn (ADR-129). */
  recordUserMessage(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    parts: LangyMessagePart[];
    role?: LangyMessageRole;
  }): Promise<{ messageId: string }> {
    return this.dependencies.langy.recordUserMessage(input);
  }

  /** Every card and connection state for one conversation, off the durable record (ADR-129). */
  getLocalRecord(input: {
    projectId: string;
    conversationId: string;
    userId: string;
  }): Promise<LangyLocalRecord> {
    return this.dependencies.langy.getLocalRecord(input);
  }

  /** The conversation spine, raising the feature's not-found when it is not visible. */
  getById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail> {
    return this.dependencies.langy.getById(input);
  }

  /** Whether the panel should ask for feedback under the latest answer. */
  shouldAskFeedback(input: {
    userId: string;
    conversationId: string;
    assistantAnswerCount: number;
  }): Promise<boolean> {
    return this.dependencies.langy.shouldAskFeedback(input);
  }

  /** Starts the quiet period: showing the feedback card counts as asking. */
  markFeedbackShown(input: { userId: string; conversationId: string }): Promise<void> {
    return this.dependencies.langy.markFeedbackShown(input);
  }

  /** Records the durable stopped terminal for an in-flight turn. Idempotent. */
  stopTurn(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<void> {
    return this.dependencies.langy.stopTurn(input);
  }

  // -- the panel's procedures -------------------------------------------------

  listConversations(
    input: LangyPanelCall<typeof langyListInputSchema>,
  ): Promise<LangyConversationListPageDto> {
    return this.dependencies.panelConversations.listConversations(input);
  }

  getConversationEventsAfter(
    input: LangyPanelCall<typeof langyEventsAfterInputSchema>,
  ): Promise<LangyConversationEventPageDto> {
    return this.dependencies.panelConversations.getConversationEventsAfter(input);
  }

  findVisibleConversationDetails(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<LangyConversationDetailDto[]> {
    return this.dependencies.panelConversations.findVisibleConversationDetails(input);
  }

  getConversationMessages(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<LangyConversationMessagesDto> {
    return this.dependencies.panelConversations.getConversationMessages(input);
  }

  archiveConversation(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<{ success: boolean }> {
    return this.dependencies.panelConversations.archiveConversation(input);
  }

  renameConversation(
    input: LangyPanelCall<typeof langyRenameInputSchema>,
  ): Promise<LangyConversationDetailDto> {
    return this.dependencies.panelConversations.renameConversation(input);
  }

  forkConversation(
    input: LangyPanelCall<typeof langyForkInputSchema>,
  ): Promise<LangyConversationDetailDto> {
    return this.dependencies.panelConversations.forkConversation(input);
  }

  createConversationTurn(
    input: LangyPanelCall<typeof langyPanelCreateConversationInputSchema>,
  ): Promise<{ conversationId: string; turnId: string }> {
    return this.dependencies.panelConversations.createConversationTurn(input);
  }

  continueConversationTurn(
    input: LangyPanelCall<typeof langyContinueConversationInputSchema>,
  ): Promise<{ conversationId: string; turnId: string }> {
    return this.dependencies.panelConversations.continueConversationTurn(input);
  }

  stopPanelTurn(
    input: LangyPanelCall<typeof langyStopTurnPanelInputSchema>,
  ): Promise<{ stopped: boolean }> {
    return this.dependencies.panelConversations.stopPanelTurn(input);
  }

  warmPanelWorker(
    input: LangyPanelCall<typeof langyWarmWorkerInputSchema>,
  ): Promise<{ conversationId: string | null; warmed: boolean }> {
    return this.dependencies.panelConversations.warmPanelWorker(input);
  }

  getModelsAllowed(
    input: LangyPanelCall<typeof langyProjectInputSchema>,
  ): Promise<{ modelsAllowed: string[] | null }> {
    return this.dependencies.panelConversations.getModelsAllowed(input);
  }

  recordFeedback(input: LangyPanelCall<typeof langyRecordFeedbackInputSchema>): Promise<void> {
    return this.dependencies.panelConversations.recordFeedback(input);
  }

  markFeedbackPromptShown(
    input: LangyPanelCall<typeof langyFeedbackPromptShownInputSchema>,
  ): Promise<void> {
    return this.dependencies.panelConversations.markFeedbackPromptShown(input);
  }

  watchConversationUpdates(
    input: LangyPanelCall<typeof langyProjectInputSchema> & { signal?: AbortSignal },
  ): AsyncIterable<z.infer<typeof langyConversationUpdateFrameSchema>> {
    return this.dependencies.panelConversations.watchConversationUpdates(input);
  }

  watchTurnStream(
    input: LangyPanelCall<typeof langyTurnStreamInputSchema> & { signal?: AbortSignal },
  ): AsyncIterable<LangyStreamEntry> {
    return this.dependencies.panelConversations.watchTurnStream(input);
  }

  getPanelLocalRecord(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<LangyLocalRecord> {
    return this.dependencies.panelLocal.getPanelLocalRecord(input);
  }

  getPanelLocalWorkspace(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<z.infer<typeof langyLocalWorkspaceStatusSchema>> {
    return this.dependencies.panelLocal.getPanelLocalWorkspace(input);
  }

  getCodeAccessPreference(
    input: LangyPanelCall<typeof langyProjectInputSchema>,
  ): Promise<{ preference: "github" | null }> {
    return this.dependencies.panelLocal.getCodeAccessPreference(input);
  }

  setCodeAccessPreference(
    input: LangyPanelCall<typeof langySetCodeAccessPreferenceInputSchema>,
  ): Promise<{ preference: "github" | null }> {
    return this.dependencies.panelLocal.setCodeAccessPreference(input);
  }

  claimUiAction(
    input: LangyPanelCall<typeof langyClaimUiActionInputSchema>,
  ): Promise<{ isClaimed: boolean }> {
    return this.dependencies.panelConversations.claimUiAction(input);
  }

  completeUiAction(
    input: LangyPanelCall<typeof langyCompleteUiActionInputSchema>,
  ): Promise<{ isAccepted: boolean }> {
    return this.dependencies.panelConversations.completeUiAction(input);
  }

  answerLocalPermission(
    input: LangyPanelCall<typeof langyAnswerLocalPermissionInputSchema>,
  ): Promise<{ answered: true }> {
    return this.dependencies.panelLocal.answerLocalPermission(input);
  }

  answerLocalQuestion(
    input: LangyPanelCall<typeof langyAnswerQuestionInputSchema>,
  ): Promise<{ answered: true }> {
    return this.dependencies.panelLocal.answerLocalQuestion(input);
  }

  setLocalPolicy(
    input: LangyPanelCall<typeof langySetLocalPolicyInputSchema>,
  ): Promise<{ skipPermissions: boolean }> {
    return this.dependencies.panelLocal.setLocalPolicy(input);
  }

  disconnectLocalWorkspace(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<{ disconnected: boolean }> {
    return this.dependencies.panelLocal.disconnectLocalWorkspace(input);
  }

  renewLocalControlRequest(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<{ expiresAt: string }> {
    return this.dependencies.panelLocal.renewLocalControlRequest(input);
  }

  getEgressState(
    input: LangyPanelCall<typeof langyEgressGetInputSchema>,
  ): Promise<z.infer<typeof langyEgressStateSchema>> {
    return this.dependencies.panelEgress.getEgressState(input);
  }

  setEgressState(
    input: LangyPanelCall<typeof langyEgressSetInputSchema>,
  ): Promise<z.infer<typeof langyEgressStateSchema>> {
    return this.dependencies.panelEgress.setEgressState(input);
  }
}
