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
  type HttpAgentTestInput,
  type AgentConnection,
  type AgentConnectCredentials,
  type AgentConnectFramesInput,
  type AgentConnectPollInput,
  type AgentConnectRegisterInput,
  AgentRegisterRefusedError,
  AgentNotFoundError,
  AgentHttpTestingUnavailableError,
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
  type AgentTestRunResult,
  type HttpProxyResult,
  type AgentConnectRegisterAnswer,
  type AgentConnectPollAnswer,
  type CallOutcome,
  type AgentCopyCreated,
  type AgentPushToCopies,
  type AgentConnectRegisterOutput,
  type AgentCallResult,
  type AgentTestTurnResult,
  type AgentHistoryEntry,
  type AgentCopy,
  type RelatedAgentEntities,
  type AgentReferenceState,
  type AgentOverviewPage,
  type AgentPage,
  type AgentOverview,
} from "@langwatch/agent-contract";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi, type AuthzPermission } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { generate } from "@langwatch/ksuid";
import { ProjectApi, ProjectNotFoundError } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { ScenarioApi } from "@langwatch/scenario-contract";
import type { Instant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

import type { AgentRepositories } from "../repositories/agent.repositories.ts";
import { agentPlatformUrl } from "../rules/agent-platform-url.rules.ts";
import { agentWithResolvedFields, declaredAgentParameters } from "../rules/agent-view.rules.ts";
import { AgentCopyService } from "../services/agent-copy.service.ts";
import { AgentService } from "../services/agent.service.ts";
import {
  ConnectedAgentPresenceService,
  type AgentPresence,
} from "../services/connected-agent-presence.service.ts";
import { ConnectedAgentService } from "../services/connected-agent.service.ts";
import type { HttpAgentTestService } from "../services/http-agent-test.service.ts";

/**
 * The app's KSUID resource for a call's thread id (`KSUID_RESOURCES.THREAD`).
 * The literal rather than the app's constant table: the prefix is part of
 * the id format already written to the store, so it belongs with the writer.
 */
const THREAD_KSUID_RESOURCE = "thread";

/**
 * Shapes restated rather than imported from `@langwatch/process-stores`: a
 * module depends on contracts. `publicBaseUrl` is the process's own fact,
 * absent where the deployment named no `BASE_HOST`.
 */
type AgentMembers = Readonly<{
  redis: RedisConnection;
  publicBaseUrl: string | undefined;
}>;

/**
 * The relay behind connected agents runs on the process's own `redis` member.
 * A deployment that named no Redis refuses at boot naming this module, rather
 * than starting with the relay quietly switched off.
 */
type AgentSetup = FeatureSetup<
  typeof AgentApp.dependencies,
  AgentMembers,
  AgentServerConfig,
  AgentRepositories
>;

export class AgentApp implements AgentApi {
  static readonly contract = AgentApi;
  static readonly config = agentServerConfig;
  static readonly dependencies = {
    apiKeys: ApiKeyApi,
    auditLog: AuditLogApi,
    permissions: AuthzApi,
    projects: ProjectApi,
    scenarios: ScenarioApi,
    traces: TraceApi,
    users: UserApi,
    workflows: WorkflowApi,
  };
  /** Both names are from the process's vocabulary; boot refuses by name. */
  static readonly reads = ["redis", "publicBaseUrl"] as const;

  readonly #agents: AgentService;
  readonly #presence = ConnectedAgentPresenceService.create();
  readonly #copies: AgentCopyService;
  readonly #connected: ConnectedAgentService | undefined;
  /** No process supplies HTTP-based agent testing yet; see the batch-a handoff. */
  readonly #httpTesting: HttpAgentTestService | undefined;
  readonly #auditLog: AuditLogApi;
  readonly #permissions: AuthzApi;
  readonly #projects: ProjectApi;
  readonly #scenarios: ScenarioApi;
  readonly #users: UserApi;
  readonly #workflows: WorkflowApi;
  readonly #publicBaseUrl: string;

  private constructor({ repositories, dependencies, members, config, resources }: AgentSetup) {
    this.#agents = AgentService.create(repositories.agents);
    this.#copies = AgentCopyService.create({
      repository: repositories.agents,
      workflows: dependencies.workflows,
    });
    this.#publicBaseUrl = members.publicBaseUrl ?? "";
    this.#auditLog = dependencies.auditLog;
    this.#permissions = dependencies.permissions;
    this.#projects = dependencies.projects;
    this.#scenarios = dependencies.scenarios;
    this.#users = dependencies.users;
    this.#workflows = dependencies.workflows;
    this.#httpTesting = void 0;

    const connected = ConnectedAgentService.create({
      agents: this.#agents,
      apiKeys: dependencies.apiKeys,
      authz: dependencies.permissions,
      projects: dependencies.projects,
      redis: members.redis,
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

  static create(setup: AgentSetup): AgentApp {
    return new AgentApp(setup);
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
    return this.#withFields(await this.#agents.create(input));
  }

  async update(input: UpdateAgentCommand): Promise<AgentWithFields> {
    return this.#withFields(await this.#agents.update(input));
  }

  archive(input: GetAgentInput): Promise<Agent> {
    return this.#agents.archive(input);
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
  getConnectedByName(input: ConnectedAgentsInput): Promise<Agent[]> {
    return this.#agents.getConnectedByName(input);
  }
  findConnectedInProjects(input: { projectIds: string[] }): Promise<Agent[]> {
    return this.#agents.findConnectedInProjects(input);
  }
  getConnectedByNameAndEnvironment(input: ConnectedAgentsEnvironmentInput): Promise<Agent[]> {
    return this.#agents.getConnectedByNameAndEnvironment(input);
  }

  async relatedEntities(input: GetAgentInput): Promise<RelatedAgentEntities> {
    const agent = await this.#agents.getById(input);
    const workflowIds = findLinkedWorkflowIds(agent);
    const workflows =
      workflowIds.length > 0
        ? await this.#workflows.listSummaries({ projectId: input.projectId, workflowIds })
        : [];
    return { workflow: workflows[0] ?? null };
  }

  async cascadeArchive(input: GetAgentInput): Promise<{
    agent: Agent;
    archivedWorkflow: {
      id: string;
    } | null;
  }> {
    const agent = await this.#agents.getById(input);
    const [workflowId] = findLinkedWorkflowIds(agent);
    const archivedWorkflow = workflowId
      ? await this.#workflows.archiveLinked({ workflowId, projectId: input.projectId })
      : null;
    return { agent: await this.#agents.archive(input), archivedWorkflow };
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

  copy(input: CopyAgentCommand): Promise<{
    id: string;
    projectId: string;
    name: string;
    copiedFromAgentId: string;
  }> {
    return this.#copies.copy(input);
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

  async copyForActor(input: CopyAgentCommand & { actorId: string }): Promise<AgentCopyCreated> {
    await this.#assertSourcePermission(input.actorId, input.sourceProjectId);
    return this.copy(input);
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
    const entries = await this.#auditLog.listEntityHistory({
      projectId: input.projectId,
      entityId: input.agentId,
      actionPrefix: "agents.",
      argumentNames: ["id", "agentId", "newAgentId"],
      limit: 100,
    });
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

  async testTurn(
    input: GetAgentInput & {
      actorId: string;
      message: string;
      params?: Record<string, string | number | boolean>;
    },
  ): Promise<AgentTestTurnResult> {
    const agent = await this.#withFields(await this.#agents.getById(input));
    return this.#scenarios.testAgentTurn({
      projectId: input.projectId,
      agent,
      message: input.message,
      params: input.params,
      actor: { id: input.actorId, label: "user" },
    });
  }

  async testRun(input: AgentReferenceInput & { actorId: string }): Promise<AgentTestRunResult> {
    const agent = await this.#withFields(
      await this.#agents.getById({ id: input.agentId, projectId: input.projectId }),
    );
    return this.#scenarios.testAgentRun({
      projectId: input.projectId,
      agent,
      actor: { id: input.actorId, label: "user" },
    });
  }

  executeHttpTest(input: HttpAgentTestInput & { actorId: string }): Promise<HttpProxyResult> {
    if (!this.#httpTesting) throw new AgentHttpTestingUnavailableError();
    return this.#httpTesting.execute(input);
  }

  acceptConnection(
    connection: AgentConnection,
    credentials: AgentConnectCredentials,
  ): Promise<void> {
    return this.#connections().acceptConnection(connection, credentials);
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

  async #withFields(agent: Agent): Promise<AgentWithFields> {
    const workflowIds = findLinkedWorkflowIds(agent);
    const fields =
      workflowIds.length > 0
        ? await this.#workflows.listFields({ projectId: agent.projectId, workflowIds })
        : {};
    return agentWithResolvedFields(agent, fields);
  }

  async #enrich(agents: Agent[], input: AgentProjectInput & { viewerUserId?: string | null }) {
    const owned = agents.map((agent) => ({ ...agent, ownerUserId: agent.ownerUserId ?? null }));
    const workflowIds = [...new Set(agents.flatMap((agent) => findLinkedWorkflowIds(agent)))];
    const [owners, presence, fields] = await Promise.all([
      this.ownersOf(owned),
      this.#connected?.listPresence({ projectId: input.projectId, agents }) ??
        Promise.resolve(new Map<string, AgentPresence>()),
      workflowIds.length
        ? this.#workflows.listFields({ projectId: input.projectId, workflowIds })
        : Promise.resolve({}),
    ]);

    return owned.map((agent) => ({
      ...agentWithResolvedFields(agent, fields),
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
