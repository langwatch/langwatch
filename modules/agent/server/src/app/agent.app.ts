import { TraceApi } from "@langwatch/trace-contract";
import type { AgentCallSignal } from "@langwatch/agent-contract";
import {
  AgentApi,
  type AgentWorkflowInput,
  type UpdateAgentWorkflowConfigInput,
  agentServerConfigSchema,
  linkedWorkflowId,
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
} from "@langwatch/agent-contract";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi, type AuthzPermission } from "@langwatch/authz-contract";
import { ProjectApi, ProjectNotFoundError } from "@langwatch/project-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { Instant } from "@langwatch/time";
import { z } from "zod";
import type { AgentRepositories } from "../repositories/agent.repositories.ts";
import { agentPlatformUrl } from "../rules/agent-platform-url.rules.ts";
import { agentWithResolvedFields, declaredAgentParameters } from "../rules/agent-view.rules.ts";
import { AgentService } from "../services/agent.service.ts";
import { AgentCopyService } from "../services/agent-copy.service.ts";
import { ConnectedAgentService } from "../services/connected-agent.service.ts";
import {
  ConnectedAgentPresenceService,
  type AgentPresence,
} from "../services/connected-agent-presence.service.ts";
import { HttpAgentTestService } from "../services/http-agent-test.service.ts";

const agentAppConfigSchema = z.object({
  publicBaseUrl: z.url(),
  connected: agentServerConfigSchema.nullable(),
  httpTesting: z.boolean().optional(),
});
export type AgentAppConfig = z.infer<typeof agentAppConfigSchema>;
export interface AgentInfrastructure {
  redis?: RedisConnection | null;
}
type AgentSetup = FeatureSetup<
  typeof AgentApp.dependencies,
  AgentInfrastructure,
  AgentAppConfig,
  AgentRepositories
>;

export class AgentApp implements AgentApi {
  static readonly contract = AgentApi;
  static readonly configSchema = agentAppConfigSchema;
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

  readonly #agents: AgentService;
  readonly #copies: AgentCopyService;
  readonly #connected: ConnectedAgentService | undefined;
  readonly #httpTesting: HttpAgentTestService | undefined;
  readonly #auditLog: AuditLogApi;
  readonly #permissions: AuthzApi;
  readonly #projects: ProjectApi;
  readonly #scenarios: ScenarioApi;
  readonly #users: UserApi;
  readonly #workflows: WorkflowApi;
  readonly #publicBaseUrl: string;
  readonly #relayMaxPayloadMb: number | undefined;

  private constructor({
    repositories,
    dependencies,
    infrastructure,
    config,
    resources,
  }: AgentSetup) {
    this.#agents = AgentService.create(repositories.agents);
    this.#copies = AgentCopyService.create(repositories.agents, dependencies.workflows);
    this.#publicBaseUrl = config.publicBaseUrl;
    this.#relayMaxPayloadMb = config.connected?.relayMaxPayloadMb;
    this.#auditLog = dependencies.auditLog;
    this.#permissions = dependencies.permissions;
    this.#projects = dependencies.projects;
    this.#scenarios = dependencies.scenarios;
    this.#users = dependencies.users;
    this.#workflows = dependencies.workflows;
    this.#httpTesting = config.httpTesting
      ? HttpAgentTestService.create({
          workflows: dependencies.workflows,
          traces: dependencies.traces,
        })
      : void 0;

    if (config.connected) {
      const connected = ConnectedAgentService.create({
        agents: this.#agents,
        apiKeys: dependencies.apiKeys,
        authz: dependencies.permissions,
        projects: dependencies.projects,
        redis: infrastructure.redis ?? null,
        config: config.connected,
        publicBaseUrl: config.publicBaseUrl,
      });
      this.#connected = connected;
      resources.ownService({
        name: "agent-connections",
        start: () => connected.start(),
        stop: () => connected.close(),
      });
    }
  }

  static create(setup: AgentSetup): AgentApp {
    return new AgentApp(setup);
  }

  platformUrl(input: { projectSlug: string; agentId: string; agentType: string }): string {
    return agentPlatformUrl({ publicBaseUrl: this.#publicBaseUrl, ...input });
  }

  relayMaxPayloadMb(): number | undefined {
    return this.#relayMaxPayloadMb;
  }

  async getAll(input: AgentProjectInput & { viewerUserId?: string | null }) {
    return this.#enrich(await this.#agents.getAll(input), input);
  }

  async getById(input: GetAgentInput & { viewerUserId?: string | null }) {
    const agent = await this.#agents.getById(input);
    const [enriched] = await this.#enrich([agent], input);
    return enriched!;
  }

  list(input: ListAgentsInput) {
    return this.#agents.list(input);
  }

  async listWithPresence(input: ListAgentsInput & { viewerUserId?: string | null }) {
    const page = await this.#agents.list(input);
    return { ...page, data: await this.#enrich(page.data, input) };
  }

  async create(input: CreateAgentCommand) {
    return this.#withFields(await this.#agents.create(input));
  }

  async update(input: UpdateAgentCommand) {
    return this.#withFields(await this.#agents.update(input));
  }

  archive(input: GetAgentInput) {
    return this.#agents.archive(input);
  }
  exists(input: GetAgentInput) {
    return this.#agents.exists(input);
  }
  getNamesByIds(input: AgentIdsInput) {
    return this.#agents.getNamesByIds(input);
  }
  getReferenceStates(input: AgentIdsInput) {
    return this.#agents.getReferenceStates(input);
  }

  listWorkflowConfigs(input: AgentWorkflowInput) {
    return this.#agents.listWorkflowConfigs(input);
  }

  updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void> {
    return this.#agents.updateWorkflowConfig(input);
  }
  registerConnected(input: RegisterConnectedAgentInput) {
    return this.#agents.registerConnected(input);
  }
  touchLastSeenAt(input: GetAgentInput & { at: Instant }) {
    return this.#agents.touchLastSeenAt(input);
  }
  getConnectedByName(input: ConnectedAgentsInput) {
    return this.#agents.getConnectedByName(input);
  }
  getConnectedByNameAndEnvironment(input: ConnectedAgentsEnvironmentInput) {
    return this.#agents.getConnectedByNameAndEnvironment(input);
  }

  async relatedEntities(input: GetAgentInput) {
    const agent = await this.#agents.getById(input);
    const workflowId = linkedWorkflowId(agent);
    const workflows = workflowId
      ? await this.#workflows.listSummaries({
          projectId: input.projectId,
          workflowIds: [workflowId],
        })
      : [];
    return { workflow: workflows[0] ?? null };
  }

  async cascadeArchive(input: GetAgentInput) {
    const agent = await this.#agents.getById(input);
    const workflowId = linkedWorkflowId(agent);
    const archivedWorkflow = workflowId
      ? await this.#workflows.archiveLinked({ workflowId, projectId: input.projectId })
      : null;
    return { agent: await this.#agents.archive(input), archivedWorkflow };
  }

  async getCopies(input: AgentCopiesInput) {
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

  copy(input: CopyAgentCommand) {
    return this.#copies.copy(input);
  }
  pushToCopies(input: PushAgentCopiesInput) {
    return this.#copies.pushToCopies(input);
  }
  getSourceOfCopy(input: AgentReferenceInput) {
    return this.#copies.getSourceOfCopy(input);
  }
  syncFromSource(input: AgentReferenceInput) {
    return this.#copies.syncFromSource(input);
  }

  async getCopiesForActor(input: AgentReferenceInput & { actorId: string }) {
    await this.#agents.getById({ id: input.agentId, projectId: input.projectId });
    const copies = await this.getCopies({ sourceAgentId: input.agentId });
    const allowed = await this.#permittedCopies(copies, input.actorId, "evaluations:view");
    return copies.filter((copy) => allowed.has(copy.id));
  }

  async copyForActor(input: CopyAgentCommand & { actorId: string }) {
    await this.#assertSourcePermission(input.actorId, input.sourceProjectId);
    return this.copy(input);
  }

  async pushToCopiesForActor(input: AgentReferenceInput & { actorId: string; copyIds?: string[] }) {
    const copies = await this.#copies.getCopies({ sourceAgentId: input.agentId });
    const allowed = await this.#permittedCopies(copies, input.actorId, "evaluations:manage");
    const copyIds = input.copyIds ? input.copyIds.filter((id) => allowed.has(id)) : [...allowed];
    return this.pushToCopies({
      sourceAgentId: input.agentId,
      sourceProjectId: input.projectId,
      copyIds,
    });
  }

  async syncFromSourceForActor(input: AgentReferenceInput & { actorId: string }) {
    const source = await this.getSourceOfCopy(input);
    await this.#assertSourcePermission(input.actorId, source.projectId);
    return this.syncFromSource(input);
  }

  async getHistory(input: AgentReferenceInput) {
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

  async ownersOf(agents: readonly { ownerUserId: string | null }[]) {
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
  ) {
    const agent = await this.#withFields(await this.#agents.getById(input));
    return this.#scenarios.testAgentTurn({
      projectId: input.projectId,
      agent,
      message: input.message,
      params: input.params,
      actor: { id: input.actorId, label: "user" },
    });
  }

  async testRun(input: AgentReferenceInput & { actorId: string }) {
    const agent = await this.#withFields(
      await this.#agents.getById({ id: input.agentId, projectId: input.projectId }),
    );
    return this.#scenarios.testAgentRun({
      projectId: input.projectId,
      agent,
      actor: { id: input.actorId, label: "user" },
    });
  }

  executeHttpTest(input: HttpAgentTestInput & { actorId: string }) {
    if (!this.#httpTesting) throw new AgentHttpTestingUnavailableError();
    return this.#httpTesting.execute(input);
  }

  acceptConnection(connection: AgentConnection, credentials: AgentConnectCredentials) {
    return this.#connections().acceptConnection(connection, credentials);
  }
  async call(input: AgentCallInput, context: AgentCallContext) {
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
        threadId: input.threadId ?? crypto.randomUUID(),
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
  connectRegister(body: unknown, credentials: AgentConnectCredentials) {
    return this.#connections().connectRegister(body, credentials);
  }
  connectPoll(input: AgentConnectPollInput, credentials: AgentConnectCredentials) {
    return this.#connections().connectPoll(input, credentials);
  }
  callConnected(input: {
    projectId: string;
    agent: DispatchAgent;
    call: DispatchCall;
    signal?: AgentCallSignal;
  }) {
    return this.#connections().dispatch(input);
  }
  getPresence(input: { projectId: string; agents: readonly { id: string; type: string }[] }) {
    return this.#connections().listPresence(input);
  }
  connectFrames(input: AgentConnectFramesInput, credentials: AgentConnectCredentials) {
    return this.#connections().connectFrames(input, credentials);
  }

  #connections(): ConnectedAgentService {
    if (!this.#connected) throw new AgentConnectionsUnavailableError();
    return this.#connected;
  }

  async #withFields(agent: Agent): Promise<AgentWithFields> {
    const workflowId = linkedWorkflowId(agent);
    const fields = workflowId
      ? await this.#workflows.listFields({ projectId: agent.projectId, workflowIds: [workflowId] })
      : {};
    return agentWithResolvedFields(agent, fields);
  }

  async #enrich(agents: Agent[], input: AgentProjectInput & { viewerUserId?: string | null }) {
    const owned = agents.map((agent) => ({ ...agent, ownerUserId: agent.ownerUserId ?? null }));
    const workflowIds = [
      ...new Set(
        agents.flatMap((agent) => (linkedWorkflowId(agent) ? [linkedWorkflowId(agent)!] : [])),
      ),
    ];
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
      ...ConnectedAgentPresenceService.agentPresenceView({
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
