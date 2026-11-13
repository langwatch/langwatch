import { ApiKeyApi } from "@langwatch/api-key-contract";
import type { RestIdentity } from "@langwatch/api/hosting";
import type { RestStaffAccessGate } from "@langwatch/api/rest";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  AuthApi,
  type PasskeyAssertionOptions,
  type PasskeyAssertionResponse,
} from "@langwatch/auth-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { ReactEmailMailRenderer } from "@langwatch/mail";
import { MonitorApi } from "@langwatch/monitor-contract";
import { NotificationService } from "@langwatch/notification-contract";
import { OpsApi } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import {
  StaffAccessApi,
  staffAccessConfig,
  StaffAccessNotFoundError,
  type StaffAccessAgent,
  type StaffAccessApi as StaffAccessApiContract,
  type StaffAccessApprovalChoice,
  type StaffAccessApprovalView,
  type StaffAccessCopyBody,
  type StaffAccessCopyReport,
  type StaffAccessDoorSession,
  type StaffAccessEnrolled,
  type StaffAccessOperator,
  type StaffAccessOrganizationList,
  type StaffAccessOverview,
  type StaffAccessQueueSummary,
  type StaffAccessRedeemed,
  type StaffAccessRequestBody,
  type StaffAccessRequestCreated,
  type StaffAccessRequestStatusAnswer,
  type StaffAccessServerConfig,
  type StaffAccessUsage,
} from "@langwatch/staff-access-contract";
import { type Instant, nowInstant, Temporal } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";

import type { StaffAccessRepositories } from "../repositories/staff-access.repositories.ts";
import { StaffAccessAvailabilityService } from "../services/staff-access-availability.service.ts";
import { StaffAccessCopyService } from "../services/staff-access-copy.service.ts";
import { StaffAccessDoorService } from "../services/staff-access-door.service.ts";
import { StaffAccessGateService } from "../services/staff-access-gate.service.ts";
import { StaffAccessNoticeService } from "../services/staff-access-notice.service.ts";
import { StaffAccessOpsReadService } from "../services/staff-access-ops-read.service.ts";
import { StaffAccessRequestService } from "../services/staff-access-request.service.ts";
import { StaffAccessRequesterService } from "../services/staff-access-requester.service.ts";
import { StaffAccessSessionService } from "../services/staff-access-session.service.ts";

type StaffAccessSetup = FeatureSetup<
  typeof StaffAccessModule.dependencies,
  StaffAccessServerConfig,
  StaffAccessRepositories
>;

type StaffAccessRequesterSession = Extract<StaffAccessDoorSession, { kind: "requester" }>;

/** Ops agent access (ADR-202): enrolment, passkey approval, one-hour sessions and their trail. */
export class StaffAccessModule implements StaffAccessApiContract {
  static readonly contract = StaffAccessApi;
  static readonly config = staffAccessConfig;
  static readonly dependencies = {
    /** Whether this deployment offers cloud ops, the operators, and the queue summary. */
    ops: OpsApi,
    /** The `ops_agent_access_enabled` system flag. */
    featureFlags: FeatureFlagApi,
    /** The operator's passkey ceremonies, and members holding a live browser session. */
    auth: AuthApi,
    /** The approver's name and email, for the audit row and the console. */
    users: UserApi,
    /** Resolves an organization by id or slug, and its members. */
    organizations: OrganizationApi,
    /** The projects a redeemed key reaches, and the ids usage is counted over. */
    projects: ProjectApi,
    /** Mints and revokes the one-hour staff key; lists an organization's keys for usage. */
    apiKeys: ApiKeyApi,
    /** The customer's audit log: approved, write, revoked and expired rows. */
    auditLog: AuditLogApi,
    /** Tells the other operators about an enrolment or an approval. */
    notifications: NotificationService,
    codingAgents: CodingAgentApi,
    gateway: GatewayApi,
    traces: TraceApi,
    /** The organization copy's allowlist, each read and written through its owner. */
    evaluators: EvaluatorApi,
    monitors: MonitorApi,
    prompts: PromptApi,
    datasets: DatasetApi,
  };

  readonly #availability: StaffAccessAvailabilityService;
  readonly #requesters: StaffAccessRequesterService;
  readonly #requests: StaffAccessRequestService;
  readonly #sessions: StaffAccessSessionService;
  readonly #opsRead: StaffAccessOpsReadService;
  readonly #copies: StaffAccessCopyService;
  readonly #auth: Pick<AuthApi, "hasPasskey">;
  /** The `staff_access` door the REST runtime opens for this module's routes. */
  readonly staffAccessDoor: RestIdentity;
  /** The gate every staff key's request passes before its handler. */
  readonly staffAccessGate: RestStaffAccessGate;

  private constructor(setup: StaffAccessSetup & { now: () => Instant }) {
    const { repositories, dependencies, config, now } = setup;
    const notices = StaffAccessNoticeService.create({
      ops: dependencies.ops,
      notifications: dependencies.notifications,
      renderer: ReactEmailMailRenderer.create(),
    });
    this.#availability = StaffAccessAvailabilityService.create({
      ops: dependencies.ops,
      featureFlags: dependencies.featureFlags,
    });
    this.#auth = dependencies.auth;
    this.#requesters = StaffAccessRequesterService.create({
      requesters: repositories.requesters,
      challenges: repositories.challenges,
      auth: dependencies.auth,
      ops: dependencies.ops,
      notices,
      now,
    });
    this.#sessions = StaffAccessSessionService.create({
      requests: repositories.requests,
      requesters: this.#requesters,
      apiKeys: dependencies.apiKeys,
      auditLog: dependencies.auditLog,
      users: dependencies.users,
      now,
    });
    this.#requests = StaffAccessRequestService.create({
      requests: repositories.requests,
      requesters: this.#requesters,
      auth: dependencies.auth,
      organizations: dependencies.organizations,
      projects: dependencies.projects,
      apiKeys: dependencies.apiKeys,
      auditLog: dependencies.auditLog,
      users: dependencies.users,
      notices,
      sessions: this.#sessions,
      publicBaseUrl: config.publicBaseUrl ?? null,
      now,
    });
    this.#opsRead = StaffAccessOpsReadService.create({
      events: repositories.events,
      ops: dependencies.ops,
      organizations: dependencies.organizations,
      projects: dependencies.projects,
      codingAgents: dependencies.codingAgents,
      gateway: dependencies.gateway,
      traces: dependencies.traces,
      apiKeys: dependencies.apiKeys,
      auth: dependencies.auth,
      now,
    });
    this.#copies = StaffAccessCopyService.create({
      requests: repositories.requests,
      events: repositories.events,
      ledger: repositories.copyLedger,
      ops: dependencies.ops,
      organizations: dependencies.organizations,
      projects: dependencies.projects,
      evaluators: dependencies.evaluators,
      monitors: dependencies.monitors,
      prompts: dependencies.prompts,
      datasets: dependencies.datasets,
      auditLog: dependencies.auditLog,
      now,
    });
    this.staffAccessDoor = StaffAccessDoorService.create({
      availability: this.#availability,
      requesters: this.#requesters,
      sessions: this.#sessions,
      ops: dependencies.ops,
      now,
    });
    this.staffAccessGate = StaffAccessGateService.create({
      availability: this.#availability,
      sessions: this.#sessions,
      events: repositories.events,
      ops: dependencies.ops,
      auditLog: dependencies.auditLog,
      now,
    });
  }

  /** `now` is a test's clock; the process runs on the wall clock. */
  static create(setup: StaffAccessSetup & { now?: () => Instant }): StaffAccessModule {
    return new StaffAccessModule({
      ...setup,
      now: setup.now ?? nowInstant,
    });
  }

  async overview({ actor }: StaffAccessOperator): Promise<StaffAccessOverview> {
    const { userId } = await this.#availability.operatorOf({ actor });
    const [hasPasskey, requesters, sessions] = await Promise.all([
      this.#auth.hasPasskey({ userId }),
      this.#requesters.findForOwner({ userId }),
      this.#sessions.findRecentSessions(),
    ]);
    return { hasPasskey, requesters, sessions };
  }

  async enrolOptions({ actor }: StaffAccessOperator): Promise<PasskeyAssertionOptions> {
    const { userId } = await this.#availability.operatorOf({ actor });
    return this.#requesters.enrolOptions({ userId });
  }

  async enrol({
    actor,
    name,
    assertion,
  }: StaffAccessOperator & {
    name: string;
    assertion: PasskeyAssertionResponse;
  }): Promise<StaffAccessEnrolled> {
    const { userId } = await this.#availability.operatorOf({ actor });
    return this.#requesters.enrol({ userId, name, assertion });
  }

  async revokeRequester({
    actor,
    requesterId,
  }: StaffAccessOperator & { requesterId: string }): Promise<{ ok: true }> {
    const { userId } = await this.#availability.operatorOf({ actor });
    await this.#requesters.revoke({ userId, requesterId });
    return { ok: true };
  }

  async getApprovalRequest({
    actor,
    requestId,
  }: StaffAccessOperator & { requestId: string }): Promise<StaffAccessApprovalView> {
    const { userId } = await this.#availability.operatorOf({ actor });
    return this.#requests.getApprovalRequest({ userId, requestId });
  }

  async approvalOptions({
    actor,
    ...choice
  }: StaffAccessOperator & StaffAccessApprovalChoice): Promise<PasskeyAssertionOptions> {
    const { userId } = await this.#availability.operatorOf({ actor });
    return this.#requests.approvalOptions({ userId, choice });
  }

  async approve({
    actor,
    assertion,
    ...choice
  }: StaffAccessOperator &
    StaffAccessApprovalChoice & {
      assertion: PasskeyAssertionResponse;
    }): Promise<StaffAccessApprovalView> {
    const { userId } = await this.#availability.operatorOf({ actor });
    return this.#requests.approve({ userId, choice, assertion });
  }

  async deny({
    actor,
    requestId,
  }: StaffAccessOperator & { requestId: string }): Promise<StaffAccessApprovalView> {
    const { userId } = await this.#availability.operatorOf({ actor });
    return this.#requests.deny({ userId, requestId });
  }

  async revokeSession({
    actor,
    requestId,
  }: StaffAccessOperator & { requestId: string }): Promise<{ ok: true }> {
    const { userId } = await this.#availability.operatorOf({ actor });
    await this.#sessions.revokeSession({ userId, requestId });
    return { ok: true };
  }

  async revokeAll({
    actor,
    confirmation,
  }: StaffAccessOperator & { confirmation: string }): Promise<{ revoked: number }> {
    const { userId } = await this.#availability.operatorOf({ actor });
    return this.#sessions.revokeAll({ userId, confirmation });
  }

  async createRequest({
    session,
    body,
  }: StaffAccessAgent & { body: StaffAccessRequestBody }): Promise<StaffAccessRequestCreated> {
    const requester = requesterOf(session);
    return this.#requests.createRequest({
      requesterId: requester.requesterId,
      ownerUserId: requester.ownerUserId,
      body,
      ipAddress: requester.ipAddress,
    });
  }

  async getRequestStatus({
    session,
    requestId,
  }: StaffAccessAgent & { requestId: string }): Promise<StaffAccessRequestStatusAnswer> {
    const { requesterId } = requesterOf(session);
    return this.#requests.getRequestStatus({ requesterId, requestId });
  }

  async redeem({
    session,
    requestId,
    codeVerifier,
  }: StaffAccessAgent & { requestId: string; codeVerifier: string }): Promise<StaffAccessRedeemed> {
    const requester = requesterOf(session);
    return this.#requests.redeem({
      requesterId: requester.requesterId,
      requestId,
      codeVerifier,
      ipAddress: requester.ipAddress,
    });
  }

  async endSession({
    session,
    requestId,
  }: StaffAccessAgent & { requestId: string }): Promise<{ ended: true }> {
    return this.#sessions.endByAgent({
      requestId,
      ...(session.kind === "requester"
        ? { requesterId: session.requesterId }
        : { opsRequestId: session.requestId }),
    });
  }

  listOrganizations(
    input: StaffAccessAgent & { query?: string },
  ): Promise<StaffAccessOrganizationList> {
    return this.#opsRead.listOrganizations(input);
  }

  getOrganizationUsage(
    input: StaffAccessAgent & { organization: string },
  ): Promise<StaffAccessUsage> {
    return this.#opsRead.getOrganizationUsage(input);
  }

  getQueueSummary(input: StaffAccessAgent): Promise<StaffAccessQueueSummary> {
    return this.#opsRead.getQueueSummary(input);
  }

  copyOrganization(
    input: StaffAccessAgent & { body: StaffAccessCopyBody },
  ): Promise<StaffAccessCopyReport> {
    return this.#copies.copyOrganization(input);
  }

  sweepExpiredSessions({ at }: { at: number }): Promise<{ audited: number }> {
    return this.#sessions.sweepExpiredSessions({
      at: Temporal.Instant.fromEpochMilliseconds(at),
    });
  }
}

/** Only a requester key asks, checks or redeems; an ops token is no requester. */
function requesterOf(session: StaffAccessDoorSession): StaffAccessRequesterSession {
  if (session.kind !== "requester") throw new StaffAccessNotFoundError();
  return session;
}
