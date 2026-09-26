import { INSTANCE_TOKEN_HEADER } from "@langwatch/agent-contract";
import type { ProtocolConnection } from "@langwatch/api";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  BearerIdentity,
  type RestIdentity,
  SessionKeyIdentity,
  type SessionKeyHolder,
  type SessionKeyPresented,
} from "@langwatch/api/rest";
import { AuthzApi } from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { Event, StaticPipelineDefinition } from "@langwatch/eventing";
/**
 * The Langy feature's application: what its doors call. It holds every service and process
 * capability the feature's api files reach, and it is the one typed thing a transport is given.
 */
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { GithubApi } from "@langwatch/github-contract";
import type { FeatureSetup } from "@langwatch/kernel";
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
  type LangyTurnSettlementWait,
  type LangyTurnSettlementWaitInput,
  assertLangyServerConfig,
  langyConfig,
  langySecrets,
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
import { PresenceApi } from "@langwatch/presence-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { UserApi } from "@langwatch/user-contract";
import type { Redis } from "ioredis";
import type { z } from "zod";

import { HttpLangyWorkerChannel } from "../channels/http/http.langy-worker.channel.ts";
import { UnavailableLangyWorkerChannel } from "../channels/unavailable.langy-worker.channel.ts";
import { buildLangyConversationCommands } from "../eventing/langy-conversation.commands.ts";
import type { LangySessionKeyReapDeps } from "../eventing/langy-session-key-reap.intent.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import type {
  LangyStreamBlockingRedis,
  LangyStreamRedis,
} from "../repositories/langy-token-buffer.repository.ts";
import { PrismaLangySessionKeyReapRepository } from "../repositories/prisma/prisma.langy-session-key-reap.repository.ts";
import { RedisLangyLocalControlRuntimeRepository } from "../repositories/redis/redis.langy-local-control-runtime.repository.ts";
import { readSessionKeyCredential } from "../rules/langy-local-control-connect.rules.ts";
import { LangyInternalService } from "../services/langy-internal.service.ts";
import { LocalControlConnectionService } from "../services/langy-local-control-connection.service.ts";
import { LocalControlLongPollService } from "../services/langy-local-control-long-poll.service.ts";
import { LangyLocalControlTerminalService } from "../services/langy-local-control-terminal.service.ts";
import { LocalControlSessionCoreService } from "../services/langy-local-session.service.ts";
import { LangyLocalWorkerService } from "../services/langy-local-worker.service.ts";
import { LangyLocalWorkspaceService } from "../services/langy-local-workspace.service.ts";
import { LangyMaintenanceService } from "../services/langy-maintenance.service.ts";
import { LangyPanelAccessService } from "../services/langy-panel-access.service.ts";
import { LangyPanelConversationService } from "../services/langy-panel-conversation.service.ts";
import { LangyPanelEgressService } from "../services/langy-panel-egress.service.ts";
import { LangyPanelLocalService } from "../services/langy-panel-local.service.ts";
import { LangyPostgresService } from "../services/langy-postgres.service.ts";
import { LangyRestCallerService } from "../services/langy-rest-caller.service.ts";
import { LangyRestMetricsPrometheusService } from "../services/langy-rest-metrics-prometheus.service.ts";
import { LangySessionKeyMetricsOtelService } from "../services/langy-session-key-metrics-otel.service.ts";
import { LangySessionKeyReapService } from "../services/langy-session-key-reap.service.ts";
import { LangyTurnSettlementWaiterService } from "../services/langy-turn-settlement-waiter.service.ts";
import { LangyTurnsBoundsService } from "../services/langy-turns-bounds.service.ts";
import { LangyUiActionPageService } from "../services/langy-ui-action-page.service.ts";
import { LangyVirtualKeyProvisioningService } from "../services/langy-virtual-key-provisioning.service.ts";
import { LangyWorkerMetricsOtelService } from "../services/langy-worker-metrics-otel.service.ts";
import type { LangyService } from "../services/langy.service.ts";
import { SetupSkillsService } from "../services/setup-skills.service.ts";
import { buildLangyInfrastructure } from "./langy-composition.build.ts";
import type { LangyConversationCommands, LocalControlRuntime } from "./langy.members.ts";

/**
 * The Redis surface the live-turn edge needs: the turn-access record a
 * just-started turn's actor is read from, and a dedicated connection for the
 * blocking tail. An ioredis standalone or cluster client satisfies it.
 */
export type LangyRedis = Readonly<
  LangyStreamRedis & { duplicate(): LangyStreamBlockingRedis & Pick<Redis, "disconnect"> }
>;

/** What the process composes this feature's application from. */
type LangyAppDependencies = {
  langy: LangyService;
  internalDoor: RestIdentity;
  /** The rows the module keeps outside its event log, chosen at boot. */
  repositories: LangyRepositories;
  /** Absent in a deployment without Redis; the live edge degrades to the fold. */
  redis: LangyRedis | null;
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
};

/** The local-control runtime, its durable commands, its peer reads and this origin. */
export interface LangyLocalControl {
  runtime: LocalControlRuntime;
  commands: LangyConversationCommands;
  workspace: LangyLocalWorkspaceService;
  baseHost: string | undefined;
}

const langyStores = reads("prisma", "redis", "eventing", "rateLimiter");

/** `publicBaseUrl` is the process's own fact, absent where the deployment named no `BASE_HOST`. */
type LangySetup = FeatureSetup<
  typeof LangyApp.dependencies,
  MembersRead<typeof langyStores> & Readonly<{ publicBaseUrl: string | undefined }>,
  LangyServerConfig,
  LangyRepositories
>;

export class LangyApp implements LangyApiContract {
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
  };
  static readonly config = langyConfig;
  static readonly secrets = langySecrets;
  /**
   * `eventing` is the agent-pipeline dispatcher's own producer registration
   * (`eventing/langy-conversation.commands.ts`). `rateLimiter` is the per-project counter
   * every turn is checked against.
   */
  static readonly reads = [...langyStores, "publicBaseUrl"] as const;

  static async create(setup: LangySetup): Promise<LangyApp> {
    const { channel, door } = await setup.secrets.into(langySecrets.internal, (internalSecret) => {
      assertLangyServerConfig(setup.config, internalSecret);
      const metrics = LangyWorkerMetricsOtelService.create();
      const channel =
        setup.config.agentUrl && internalSecret
          ? HttpLangyWorkerChannel.create({
              agentUrl: setup.config.agentUrl,
              internalSecret,
              metrics,
            })
          : UnavailableLangyWorkerChannel.create(metrics);
      const door = BearerIdentity.create({ name: "langy-internal", token: internalSecret });
      return { channel, door };
    });
    const built = buildLangyInfrastructure({
      redis: setup.members.redis,
      config: setup.config,
      worker: channel,
      repositories: setup.repositories,
    });
    const adapter = LangyPostgresService.create({ database: setup.members.prisma });
    const commands = buildLangyConversationCommands({
      eventing: setup.members.eventing,
      processName: "langy",
    });
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
    const sessionKeys = adapter.createSessionKeys({
      apiKeys: setup.dependencies.apiKeys,
      authz: setup.dependencies.authz,
      metrics: LangySessionKeyMetricsOtelService.create(),
    });
    const callers = LangyRestCallerService.create({
      featureFlags: setup.dependencies.featureFlags,
      actors: setup.members.prisma,
      projects: setup.dependencies.projects,
    });
    const buffer = setup.repositories.tokenBuffer.open({ redis: setup.members.redis });
    const runtime = RedisLangyLocalControlRuntimeRepository.create({
      store: setup.repositories.sessionState,
      projects: workspace,
      mintSessionKey: (input) => sessionKeys.mintForUser(input),
      events: commands,
      buffer,
    });
    const core = LocalControlSessionCoreService.create({
      apiKeys: setup.dependencies.apiKeys,
      readCredential: readSessionKeyCredential,
      actors: setup.members.prisma,
      baseHost: setup.members.publicBaseUrl,
      store: runtime.store,
      presence: runtime.presence,
      dispatcher: runtime.dispatcher,
      waits: runtime.waits,
      requests: runtime.requests,
      turns: LocalControlSessionCoreService.turnStarter({
        actors: setup.members.prisma,
        turns: langy,
      }),
      conversations: langy,
      events: commands,
      buffer,
      skipGate: (gate) => workspace.canSkipPermissions(gate),
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
      rateLimiter: setup.members.rateLimiter,
    });
    const access = LangyPanelAccessService.create({
      featureFlags: setup.dependencies.featureFlags,
      projects: setup.dependencies.projects,
      authz: setup.dependencies.authz,
    });
    const redis = setup.members.redis;
    return new LangyApp({
      langy,
      internalDoor: door,
      repositories: setup.repositories,
      redis: setup.members.redis,
      presence: setup.dependencies.presence,
      turnBounds,
      virtualKeyProvisioning: LangyVirtualKeyProvisioningService.create({
        virtualKeys: built.credentials.virtualKeys,
      }),
      sessionKeyReap: LangySessionKeyReapService.create({
        repository: PrismaLangySessionKeyReapRepository.create(setup.members.prisma),
        metrics: LangySessionKeyMetricsOtelService.create(),
      }),
      callers,
      localControl: { runtime, commands, workspace, baseHost: setup.members.publicBaseUrl },
      localWorker: LangyLocalWorkerService.create({
        runtime,
        commands,
        workspace,
        callers,
        conversations: langy,
        baseHost: setup.members.publicBaseUrl,
      }),
      localControlTerminal: LangyLocalControlTerminalService.create({
        requests: runtime.requests,
        permissions: setup.dependencies.authz,
        baseHost: setup.members.publicBaseUrl,
      }),
      longPoll,
      sockets,
      sessionKeyDoor,
      panelConversations: LangyPanelConversationService.create({
        access,
        langy,
        turnBounds,
        rateLimiter: setup.members.rateLimiter,
        presence: setup.dependencies.presence,
        turnAccess: redis ? setup.repositories.turnAccess : null,
        openBuffer: redis
          ? () => {
              const blocking = redis.duplicate();
              return {
                buffer: setup.repositories.tokenBuffer.open({ redis, blockingRedis: blocking }),
                release: () => blocking.disconnect(),
              };
            }
          : null,
        uiActions: redis ? LangyUiActionPageService.create({ redis }) : null,
      }),
      panelLocal: LangyPanelLocalService.create({
        access,
        conversations: langy,
        runtime,
        commands,
        workspace,
        projects: setup.dependencies.projects,
        baseHost: setup.members.publicBaseUrl,
      }),
      panelEgress: LangyPanelEgressService.create({ access, langy }),
    });
  }

  /**
   * The pipeline `langy_maintenance` registers (ADR-144), ported from the
   * deleted `LangyMaintenanceWorkerFeatureInstaller`. `deleteDispatchedBefore`
   * is the installing process's own outbox prune, handed in by the seam.
   */
  maintenanceEventingPipeline(
    deps: Pick<LangySessionKeyReapDeps, "deleteDispatchedBefore">,
  ): StaticPipelineDefinition<Event> {
    return LangyMaintenanceService.create({
      sessionKeyReap: {
        reap: () => this.dependencies.sessionKeyReap.reap(),
        deleteDispatchedBefore: deps.deleteDispatchedBefore,
      },
    }).buildProcessing();
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
      dependencies.redis !== null,
    );
  }

  getRestCaller(
    input: langyContractModule.LangyRestCallerInput,
  ): Promise<langyContractModule.LangyRestCaller> {
    return this.dependencies.callers.getCaller(input);
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

  getPage(input: Parameters<LangyApiContract["getPage"]>[0]): Promise<LangyConversationListPage> {
    return this.dependencies.langy.getPage(input);
  }

  getEventsAfter(
    input: Parameters<LangyApiContract["getEventsAfter"]>[0],
  ): Promise<LangyConversationEventPage> {
    return this.dependencies.langy.getEventsAfter(input);
  }

  findByIdVisible(
    input: Parameters<LangyApiContract["findByIdVisible"]>[0],
  ): Promise<LangyConversationDetail | null> {
    return this.dependencies.langy.findByIdVisible(input);
  }

  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<LangyUsageCount> {
    return this.dependencies.langy.countUsage(input);
  }

  provisionVirtualKey(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<void> {
    return this.dependencies.virtualKeyProvisioning.provision(input);
  }

  getSetupSkillPrompt(input: { projectId: string; skill: string }): Promise<{ body: string }> {
    return this.#setupSkills.getPrompt(input);
  }

  getAllByConversation(
    input: Parameters<LangyApiContract["getAllByConversation"]>[0],
  ): Promise<LangyMessageRow[]> {
    return this.dependencies.langy.getAllByConversation(input);
  }

  deleteById(input: Parameters<LangyApiContract["deleteById"]>[0]): Promise<boolean> {
    return this.dependencies.langy.deleteById(input);
  }

  updateById(
    input: Parameters<LangyApiContract["updateById"]>[0],
  ): Promise<LangyConversationDetail> {
    return this.dependencies.langy.updateById(input);
  }

  forkById(input: Parameters<LangyApiContract["forkById"]>[0]): Promise<{
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
    const { redis, repositories } = this.dependencies;

    return LangyTurnSettlementWaiterService.create().awaitTurnSettlement({
      ...input,
      langy: this,
      openBuffer: redis
        ? () => {
            const blocking = redis.duplicate();

            return {
              buffer: repositories.tokenBuffer.open({ redis, blockingRedis: blocking }),
              release: () => blocking.disconnect(),
            };
          }
        : null,
    });
  }

  warmConversationWorker(
    input: Parameters<LangyApiContract["warmConversationWorker"]>[0],
  ): Promise<{
    conversationId: string | null;
    warmed: boolean;
  }> {
    return this.dependencies.langy.warmConversationWorker(input);
  }

  findModelsAllowedForProject(projectId: string): Promise<string[] | null> {
    return this.dependencies.langy.findModelsAllowedForProject(projectId);
  }

  revokeWorkerSessionKey(
    input: Parameters<LangyApiContract["revokeWorkerSessionKey"]>[0],
  ): Promise<"revoked" | "already_revoked" | "not_found" | "refused"> {
    return this.dependencies.langy.revokeWorkerSessionKey(input);
  }

  turnExists(input: Parameters<LangyApiContract["turnExists"]>[0]): Promise<boolean> {
    return this.dependencies.langy.turnExists(input);
  }

  ingestAgentTurnResult(input: langyContractModule.LangyTurnResultInput): Promise<void> {
    return this.dependencies.langy.ingestAgentTurnResult(input);
  }

  findRunToken(input: Parameters<LangyApiContract["findRunToken"]>[0]): Promise<string | null> {
    return this.dependencies.langy.findRunToken(input);
  }

  recordToolCallStarted(
    input: Parameters<LangyApiContract["recordToolCallStarted"]>[0],
  ): Promise<void> {
    return this.dependencies.langy.recordToolCallStarted(input);
  }

  recordToolCallCompleted(
    input: Parameters<LangyApiContract["recordToolCallCompleted"]>[0],
  ): Promise<void> {
    return this.dependencies.langy.recordToolCallCompleted(input);
  }

  recordTurnHandoff(input: Parameters<LangyApiContract["recordTurnHandoff"]>[0]): Promise<void> {
    return this.dependencies.langy.recordTurnHandoff(input);
  }

  recordPlanUpdated(input: Parameters<LangyApiContract["recordPlanUpdated"]>[0]): Promise<void> {
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
