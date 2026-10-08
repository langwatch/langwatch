import {
  type AgentCallSignal,
  AgentApi,
  type VoiceTransport,
  type AgentWorkflowInput,
  type UpdateAgentWorkflowConfigInput,
  agentServerConfig,
  type AgentServerConfig,
  findLinkedWorkflowIds,
  type Agent,
  type AgentWithFields,
  type AgentProjectInput,
  type GetAgentInput,
  type AgentIdsInput,
  type AgentCreationWindowInput,
  type ListAgentsInput,
  type CreateAgentCommand,
  type UpdateAgentCommand,
  type CopyAgentCommand,
  type AgentCopiesInput,
  type AgentReferenceInput,
  type PushAgentCopiesInput,
  type ConnectedAgentsInput,
  type ConnectedAgentsEnvironmentInput,
  type RegisterConnectedAgentInput,
  type AgentConnection,
  type AgentConnectAdmission,
  type AgentConnectCredentials,
  type AgentConnectFramesInput,
  type AgentConnectPollInput,
  type AgentConnectRegisterInput,
  AgentRegisterRefusedError,
  AgentNotFoundError,
  AgentConnectionsUnavailableError,
  AgentSourcePermissionDeniedError,
  AgentOwnerOnlyError,
  connectedAgentSelectability,
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
  type AgentCallInput,
  type AgentCallContext,
  type DispatchAgent,
  type DispatchCall,
  type AgentWorkflowConfig,
  type AgentConnectRegisterAnswer,
  type AgentConnectPollAnswer,
  type CallOutcome,
  type AgentCopyCreated,
  type AgentPushToCopies,
  type AgentConnectRegisterOutput,
  type AgentCallResult,
  type AgentHistoryEntry,
  type AgentCopy,
  type AgentReferenceState,
  type AgentOverviewPage,
  type AgentPage,
  type AgentOverview,
} from "@langwatch/agent-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { type AuthzPermission } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { generate } from "@langwatch/ksuid";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi, ProjectNotFoundError } from "@langwatch/project-contract";
import { SecretApi } from "@langwatch/secret-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import {
  type AgentLifecyclePipeline,
  buildAgentLifecyclePipeline,
} from "../eventing/agent-lifecycle.pipeline.ts";
import {
  type AgentWorkflowFieldsPipeline,
  buildAgentWorkflowFieldsPipeline,
} from "../eventing/agent-workflow-fields.pipeline.ts";
import type { AgentRepositories } from "../repositories/agent.repositories.ts";
import { agentPlatformUrl } from "../rules/agent-platform-url.rules.ts";
import { agentWithResolvedFields, declaredAgentParameters } from "../rules/agent-view.rules.ts";
import { AgentCopyService } from "../services/agent-copy.service.ts";
import { AgentHttpSecretsService } from "../services/agent-http-secrets.service.ts";
import { AgentVoiceReleaseService } from "../services/agent-voice-release.service.ts";
import { AgentWorkflowFieldsService } from "../services/agent-workflow-fields.service.ts";
import { AgentService } from "../services/agent.service.ts";
import {
  ConnectedAgentPresenceService,
  type AgentPresence,
} from "../services/connected-agent-presence.service.ts";
import { ConnectedAgentService } from "../services/connected-agent.service.ts";

/**
 * The app's KSUID resource for a call's thread id (`KSUID_RESOURCES.THREAD`).
 * The literal rather than the app's constant table: the prefix is part of
 * the id format already written to the store, so it belongs with the writer.
 */
const THREAD_KSUID_RESOURCE = "thread";

/**
 * The relay behind connected agents runs on the live tier's Redis session
 * state, so a deployment that named no Redis refuses at boot naming this
 * module rather than starting with the relay quietly switched off.
 */
type AgentSetup = FeatureSetup<
  typeof AgentModule.dependencies,
  never,
  AgentServerConfig,
  AgentRepositories
>;

export class AgentModule implements AgentApi {
  static readonly contract = AgentApi;
  static readonly config = agentServerConfig;
  static readonly dependencies = {
    auditLog: AuditLogApi,
    /** Voice agents are written only where `release_voice_agents_enabled` is on (AC29). */
    featureFlags: FeatureFlagApi,
    permissions: AuthzApi,
    projects: ProjectApi,
    /** Where the token typed into an HTTP agent is stored, as a project secret. */
    secrets: SecretApi,
    users: UserApi,
  };

  readonly #agents: AgentService;
  readonly #presence = ConnectedAgentPresenceService.create();
  readonly #copies: AgentCopyService;
  readonly #voiceRelease: AgentVoiceReleaseService;
  readonly #connected: ConnectedAgentService | undefined;
  readonly #httpSecrets: AgentHttpSecretsService;
  readonly #auditLog: AuditLogApi;
  readonly #permissions: AuthzApi;
  readonly #projects: ProjectApi;
  readonly #users: UserApi;
  readonly #publicBaseUrl: string;
  readonly #lifecycle = buildAgentLifecyclePipeline();
  #lifecycleCommands: EventingCommands<AgentLifecyclePipeline> | undefined;

  private constructor({ repositories, dependencies, config, resources }: AgentSetup) {
    this.#agents = AgentService.create(repositories.agents);
    this.#httpSecrets = AgentHttpSecretsService.create({
      secrets: dependencies.secrets,
      agents: this.#agents,
    });
    this.#voiceRelease = AgentVoiceReleaseService.create({
      featureFlags: dependencies.featureFlags,
      projects: dependencies.projects,
    });
    this.#copies = AgentCopyService.create({
      repository: repositories.agents,
      voiceRelease: this.#voiceRelease,
    });
    this.#publicBaseUrl = config.publicBaseUrl ?? "";
    this.#auditLog = dependencies.auditLog;
    this.#permissions = dependencies.permissions;
    this.#projects = dependencies.projects;
    this.#users = dependencies.users;

    const connected = ConnectedAgentService.create({
      agents: this.#agents,
      sessionState: repositories.sessionState,
      config,
      publicBaseUrl: this.#publicBaseUrl,
    });
    this.#connected = connected;
    resources.ownService({
      name: "agent-connections",
      start: () => connected.start(),
      stop: () => connected.close(),
    });
  }

  static create(setup: AgentSetup): AgentModule {
    return new AgentModule(setup);
  }

  platformUrl(input: { projectSlug: string; agentId: string; agentType: string }): string {
    return agentPlatformUrl({ publicBaseUrl: this.#publicBaseUrl, ...input });
  }

  async getAll(
    input: AgentProjectInput & { viewerUserId?: string | null },
  ): Promise<AgentOverview[]> {
    return this.#enrich(await this.#agents.getAll(input), input);
  }

  async getById(input: GetAgentInput & { viewerUserId?: string | null }): Promise<AgentOverview> {
    const agent = await this.#agents.getById(input);
    const [enriched] = await this.#enrich([agent], input);
    return enriched!;
  }

  list(input: ListAgentsInput): Promise<AgentPage> {
    return this.#agents.list(input);
  }

  async listWithPresence(
    input: ListAgentsInput & { viewerUserId?: string | null },
  ): Promise<AgentOverviewPage> {
    const page = await this.#agents.list(input);
    return { ...page, data: await this.#enrich(page.data, input) };
  }

  async create(input: CreateAgentCommand): Promise<AgentWithFields> {
    await this.#voiceRelease.assertWritable({ type: input.type, projectIds: [input.projectId] });
    return agentWithResolvedFields(
      await this.#agents.create(await this.#httpSecrets.forCreate(input)),
    );
  }

  async update(input: UpdateAgentCommand): Promise<AgentWithFields> {
    // A config-only save of a stored voice agent names no type, so the stored row is asked too.
    const type =
      input.type === "voice"
        ? input.type
        : (await this.#agents.getById({ id: input.id, projectId: input.projectId })).type;
    await this.#voiceRelease.assertWritable({ type, projectIds: [input.projectId] });
    return agentWithResolvedFields(
      await this.#agents.update(await this.#httpSecrets.forUpdate(input)),
    );
  }

  async archive(input: GetAgentInput): Promise<Agent> {
    const agent = await this.#agents.archive(input);
    await this.#recordArchived({ agent, cascadedWorkflowId: null });
    return agent;
  }
  exists(input: GetAgentInput): Promise<boolean> {
    return this.#agents.exists(input);
  }
  getNamesByIds(input: AgentIdsInput): Promise<
    {
      id: string;
      name: string;
    }[]
  > {
    return this.#agents.getNamesByIds(input);
  }
  getReferenceStates(input: AgentIdsInput): Promise<AgentReferenceState[]> {
    return this.#agents.getReferenceStates(input);
  }

  listWorkflowConfigs(input: AgentWorkflowInput): Promise<AgentWorkflowConfig[]> {
    return this.#agents.listWorkflowConfigs(input);
  }

  updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void> {
    return this.#agents.updateWorkflowConfig(input);
  }
  registerConnected(input: RegisterConnectedAgentInput): Promise<Agent> {
    return this.#agents.registerConnected(input);
  }
  createVoiceAgent(input: {
    id: string;
    projectId: string;
    name: string;
    transport: VoiceTransport;
    agentId: string;
  }): Promise<Agent> {
    return this.#agents.createVoiceAgent(input);
  }
  hasVoiceAgentForExternalId(input: {
    projectId: string;
    transport: VoiceTransport;
    agentExternalId: string;
  }): Promise<boolean> {
    return this.#agents.hasVoiceAgentForExternalId(input);
  }
  touchLastSeenAt(input: GetAgentInput & { at: Instant }): Promise<void> {
    return this.#agents.touchLastSeenAt(input);
  }
  findIdsCreatedInWindow(input: AgentCreationWindowInput): Promise<string[]> {
    return this.#agents.findIdsCreatedInWindow(input);
  }
  getConnectedByName(input: ConnectedAgentsInput): Promise<Agent[]> {
    return this.#agents.getConnectedByName(input);
  }
  findConnectedInProjects(input: { projectIds: string[] }): Promise<Agent[]> {
    return this.#agents.findConnectedInProjects(input);
  }
  getConnectedByNameAndEnvironment(input: ConnectedAgentsEnvironmentInput): Promise<Agent[]> {
    return this.#agents.getConnectedByNameAndEnvironment(input);
  }

  async cascadeArchive(input: GetAgentInput): Promise<{
    agent: Agent;
    archivedWorkflow: {
      id: string;
    } | null;
  }> {
    const [workflowId] = findLinkedWorkflowIds(await this.#agents.getById(input));
    const agent = await this.#agents.archive(input);
    // Workflow archives the graph from its own side on the fact, seconds later (plan §7, R7).
    await this.#recordArchived({ agent, cascadedWorkflowId: workflowId ?? null });
    return { agent, archivedWorkflow: workflowId ? { id: workflowId } : null };
  }

  /** The agent lifecycle pipeline this module registers, built once with the module. */
  lifecyclePipeline(): AgentLifecyclePipeline {
    return this.#lifecycle;
  }

  /** Binds the built lifecycle pipeline's own senders. */
  connectLifecycleCommands(commands: EventingCommands<AgentLifecyclePipeline>): void {
    this.#lifecycleCommands = commands;
  }

  /** Keeps linked graphs' fields from workflow's facts, from agent's own side (§9). */
  workflowFieldsPipeline(): AgentWorkflowFieldsPipeline {
    return buildAgentWorkflowFieldsPipeline({
      fields: AgentWorkflowFieldsService.create({ agents: this.#agents }),
    });
  }

  async #recordArchived(input: { agent: Agent; cascadedWorkflowId: string | null }): Promise<void> {
    if (!this.#lifecycleCommands) {
      throw new Error("agent_lifecycle pipeline senders are not connected yet");
    }
    await this.#lifecycleCommands.recordAgentArchived.send({
      tenantId: input.agent.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      agentId: input.agent.id,
      projectId: input.agent.projectId,
      cascadedWorkflowId: input.cascadedWorkflowId,
    });
  }

  async getCopies(input: AgentCopiesInput): Promise<AgentCopy[]> {
    const copies = await this.#copies.getCopies(input);
    const paths = await this.#projects.listPaths({
      projectIds: [...new Set(copies.map((copy) => copy.projectId))],
    });
    const pathsById = new Map(paths.map((path) => [path.projectId, path.fullPath]));
    return copies.map((copy) => {
      const fullPath = pathsById.get(copy.projectId);
      if (fullPath === void 0) {
        throw new ProjectNotFoundError("Agent copy project not found", {
          meta: { projectId: copy.projectId },
        });
      }

      return { ...copy, fullPath };
    });
  }

  createCopy(input: CopyAgentCommand): Promise<AgentCopyCreated> {
    return this.#copies.createCopy(input);
  }
  pushToCopies(input: PushAgentCopiesInput): Promise<{
    pushedTo: number;
    selectedCopies: number;
  }> {
    return this.#copies.pushToCopies(input);
  }
  getSourceOfCopy(input: AgentReferenceInput): Promise<Agent> {
    return this.#copies.getSourceOfCopy(input);
  }
  syncFromSource(input: AgentReferenceInput): Promise<{
    ok: true;
  }> {
    return this.#copies.syncFromSource(input);
  }

  async getCopiesForActor(input: AgentReferenceInput & { actorId: string }): Promise<AgentCopy[]> {
    await this.#agents.getById({ id: input.agentId, projectId: input.projectId });
    const copies = await this.getCopies({ sourceAgentId: input.agentId });
    const allowed = await this.#permittedCopies(copies, input.actorId, "evaluations:view");
    return copies.filter((copy) => allowed.has(copy.id));
  }

  async pushToCopiesForActor(
    input: AgentReferenceInput & { actorId: string; copyIds?: string[] },
  ): Promise<AgentPushToCopies> {
    const copies = await this.#copies.getCopies({ sourceAgentId: input.agentId });
    const allowed = await this.#permittedCopies(copies, input.actorId, "evaluations:manage");
    const copyIds = input.copyIds ? input.copyIds.filter((id) => allowed.has(id)) : [...allowed];
    return this.pushToCopies({
      sourceAgentId: input.agentId,
      sourceProjectId: input.projectId,
      copyIds,
    });
  }

  async syncFromSourceForActor(input: AgentReferenceInput & { actorId: string }): Promise<{
    ok: true;
  }> {
    const source = await this.getSourceOfCopy(input);
    await this.#assertSourcePermission(input.actorId, source.projectId);
    return this.syncFromSource(input);
  }

  async getHistory(input: AgentReferenceInput): Promise<AgentHistoryEntry[]> {
    await this.#agents.getById({ id: input.agentId, projectId: input.projectId });
    const query = {
      projectId: input.projectId,
      entityId: input.agentId,
      argumentNames: ["id", "agentId", "newAgentId"],
      limit: 100,
    };
    /** Copies are audited at workflow's door; older ones stay under `agents.copy`. */
    const [own, copies] = await Promise.all([
      this.#auditLog.listEntityHistory({ ...query, actionPrefix: "agents." }),
      this.#auditLog.listEntityHistory({ ...query, actionPrefix: "workflow.copyAgent" }),
    ]);
    const entries = [...own, ...copies]
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, query.limit);
    const userIds = [...new Set(entries.flatMap((entry) => (entry.userId ? [entry.userId] : [])))];
    const users = userIds.length ? await this.#users.getProfiles({ userIds }) : [];
    const byId = new Map(
      users.map((user) => [user.id, { id: user.id, name: user.name, email: user.email }]),
    );
    return entries.map(({ userId, ...entry }) => ({
      ...entry,
      user: userId ? (byId.get(userId) ?? null) : null,
    }));
  }

  async ownersOf(agents: readonly { ownerUserId: string | null }[]): Promise<
    Map<
      string,
      {
        userId: string;
        name: string | null;
      }
    >
  > {
    const userIds = [
      ...new Set(agents.flatMap((agent) => (agent.ownerUserId ? [agent.ownerUserId] : []))),
    ];
    const users = userIds.length ? await this.#users.getProfiles({ userIds }) : [];
    const names = new Map(users.map((user) => [user.id, user.name]));
    return new Map(userIds.map((userId) => [userId, { userId, name: names.get(userId) ?? null }]));
  }

  acceptConnection(connection: AgentConnection, admission: AgentConnectAdmission): Promise<void> {
    this.#connections().acceptConnection(connection, admission);
    return Promise.resolve();
  }
  async call(input: AgentCallInput, context: AgentCallContext): Promise<AgentCallResult> {
    const agent = await this.#agents.getById({ id: input.id, projectId: input.projectId });
    if (agent.type !== "connected") throw new AgentNotFoundError(input.id, input.projectId);
    const ownerUserId = agent.ownerUserId;
    if (
      ownerUserId &&
      !connectedAgentSelectability({ ownerUserId, viewerUserId: context.viewerUserId }).selectable
    ) {
      const owners = await this.ownersOf([{ ownerUserId }]);
      throw new AgentOwnerOnlyError({
        agentId: agent.id,
        agentName: agent.name,
        ownerUserId,
        ownerName: owners.get(ownerUserId)?.name ?? null,
      });
    }

    const outcome = await this.#connections().dispatch({
      projectId: input.projectId,
      agent: {
        id: agent.id,
        name: agent.name,
        environment: agent.environment ?? null,
        timeoutMs: Math.min(agent.config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS),
        isSticky: agent.config.sticky ?? false,
      },
      call: {
        threadId: input.threadId ?? generate(THREAD_KSUID_RESOURCE).toString(),
        messages: input.messages,
        newMessages: input.newMessages ?? input.messages.slice(-1),
        params: input.params ?? {},
        session: input.session,
        traceparent: input.traceparent ?? context.traceparent,
        run: input.run ?? {},
      },
      signal: context.signal,
    });

    return {
      output: outcome.output,
      ...(outcome.session !== void 0 ? { session: outcome.session } : {}),
      instance: { hostname: outcome.instance.hostname, label: outcome.instance.label },
      durationMs: outcome.durationMs,
    };
  }
  connectRegister(
    body: unknown,
    credentials: AgentConnectCredentials,
  ): Promise<AgentConnectRegisterAnswer> {
    return this.#connections().connectRegister(body, credentials);
  }
  async registerConnectedAgentInstance(
    input: AgentConnectRegisterInput,
    credentials: AgentConnectCredentials,
  ): Promise<AgentConnectRegisterOutput> {
    const answer = await this.#connections().connectRegister(input, credentials);

    if (answer.frame.type === "refused") {
      throw new AgentRegisterRefusedError({
        reason: answer.frame.code,
        message: answer.frame.message,
        meta: answer.frame.meta,
      });
    }

    return { frame: answer.frame, instanceToken: answer.instanceToken };
  }
  connectPoll(
    input: AgentConnectPollInput,
    credentials: AgentConnectCredentials,
  ): Promise<AgentConnectPollAnswer> {
    return this.#connections().connectPoll(input, credentials);
  }
  callConnected(input: {
    projectId: string;
    agent: DispatchAgent;
    call: DispatchCall;
    signal?: AgentCallSignal;
  }): Promise<CallOutcome> {
    return this.#connections().dispatch(input);
  }
  getPresence(input: {
    projectId: string;
    agents: readonly { id: string; type: string }[];
  }): Promise<Map<string, AgentPresence>> {
    return this.#connections().listPresence(input);
  }
  connectFrames(
    input: AgentConnectFramesInput,
    credentials: AgentConnectCredentials,
  ): Promise<{
    accepted: number;
  }> {
    return this.#connections().connectFrames(input, credentials);
  }

  #connections(): ConnectedAgentService {
    if (!this.#connected) throw new AgentConnectionsUnavailableError();
    return this.#connected;
  }

  async #enrich(agents: Agent[], input: AgentProjectInput & { viewerUserId?: string | null }) {
    const owned = agents.map((agent) => ({ ...agent, ownerUserId: agent.ownerUserId ?? null }));
    const [owners, presence] = await Promise.all([
      this.ownersOf(owned),
      this.#connected?.listPresence({ projectId: input.projectId, agents }) ??
        Promise.resolve(new Map<string, AgentPresence>()),
    ]);

    return owned.map((agent) => ({
      ...agentWithResolvedFields(agent),
      environment: agent.environment ?? null,
      ownerUserId: agent.ownerUserId ?? null,
      hostLabel: agent.hostLabel ?? null,
      lastSeenAt: agent.lastSeenAt ?? null,
      parameters: declaredAgentParameters(agent),
      ...this.#presence.agentPresenceView({
        agent,
        owners,
        presence,
        viewerUserId: input.viewerUserId,
      }),
    }));
  }

  async #permittedCopies(
    copies: readonly { id: string; projectId: string }[],
    actorId: string,
    permission: AuthzPermission,
  ) {
    const allowed = await Promise.all(
      copies.map(async (copy) => ({
        id: copy.id,
        allowed: await this.#permissions.hasProjectPermission({
          userId: actorId,
          projectId: copy.projectId,
          permission,
        }),
      })),
    );
    return new Set(allowed.filter((copy) => copy.allowed).map((copy) => copy.id));
  }

  async #assertSourcePermission(actorId: string, projectId: string): Promise<void> {
    if (
      !(await this.#permissions.hasProjectPermission({
        userId: actorId,
        projectId,
        permission: "evaluations:manage",
      }))
    ) {
      throw new AgentSourcePermissionDeniedError();
    }
  }
}
