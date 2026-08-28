import {
  codingAgentSessionEventRecordSchema,
  type CodingAgentSession,
  type CodingAgentSessionBranchRecord,
  type CodingAgentSessionEvent,
  type CodingAgentSessionEventRecord,
  type CodingAgentTraceSessionRecord,
} from "@langwatch/coding-agent-contract";
import {
  CODING_AGENT_TEST_NOW_MS,
  codingAgentSessionFixture,
} from "@langwatch/coding-agent-contract/testing";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { createServer, type Server } from "node:http";
import {
  GithubService,
  type GithubPullRequest,
} from "@langwatch/github-contract";
import {
  ProjectService,
  projectWithTeamSchema,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import { CodingAgentBillingPolicyPort } from "../../src/ports/coding-agent-billing.port";
import { CodingAgentClockPort } from "../../src/ports/coding-agent-clock.port";
import { CodingAgentClickHousePort } from "../../src/ports/coding-agent-clickhouse.port";
import { CodingAgentSessionEventRepository } from "../../src/repositories/coding-agent-session-event.repository";
import { CodingAgentSessionRepository } from "../../src/repositories/coding-agent-session.repository";
import { CodingAgentTraceSessionRepository } from "../../src/repositories/coding-agent-trace-session.repository";
import {
  SessionMetricSeriesRepository,
  type SessionMetricTotal,
} from "../../src/repositories/session-metric-series.repository";

export const TEST_NOW_MS = CODING_AGENT_TEST_NOW_MS;

type ClickHouseRequest = { url: string; body: string };

/** A typed local ClickHouse wire fixture for package runtime-adapter tests. */
export class TestClickHouseEndpoint extends CodingAgentClickHousePort {
  private constructor(
    private readonly server: Server,
    private readonly client: ClickHouseClient,
    readonly requests: ClickHouseRequest[],
    readonly queryRows: Array<Array<Record<string, unknown>>>,
  ) {
    super();
  }

  static async create(): Promise<TestClickHouseEndpoint> {
    const requests: ClickHouseRequest[] = [];
    const queryRows: Array<Array<Record<string, unknown>>> = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      requests.push({ url: request.url ?? "", body });
      const rows = queryRows.shift() ?? [];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test ClickHouse endpoint did not bind a TCP port");
    }
    const endpoint = new TestClickHouseEndpoint(
      server,
      createClient({ url: `http://127.0.0.1:${address.port}` }),
      requests,
      queryRows,
    );
    return endpoint;
  }

  async resolve(): Promise<ClickHouseClient> {
    return this.client;
  }

  async close(): Promise<void> {
    await this.client.close();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

export function session(overrides: Partial<CodingAgentSession> = {}): CodingAgentSession {
  return codingAgentSessionFixture(overrides);
}

export function branchSession(
  overrides: Partial<CodingAgentSessionBranchRecord> = {},
): CodingAgentSessionBranchRecord {
  return {
    sessionId: "session-1",
    tenantId: "project-1",
    startedAtMs: TEST_NOW_MS - 60_000,
    lastEventOccurredAtMs: TEST_NOW_MS - 1_000,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    agent: "claude_code",
    models: [],
    userId: "user-1",
    gitBranch: "main",
    gitBranches: [],
    title: "",
    ...overrides,
  };
}

export function pullRequest(overrides: Partial<GithubPullRequest> = {}): GithubPullRequest {
  return {
    organizationId: "organization-1",
    repositoryHost: "github.com",
    repositoryFullName: "langwatch/langwatch",
    headBranch: "main",
    prNumber: 1,
    htmlUrl: "https://github.com/langwatch/langwatch/pull/1",
    title: "Pull request",
    state: "open",
    isDraft: false,
    authorLogin: "octocat",
    prCreatedAt: new Date(TEST_NOW_MS - 60_000),
    prClosedAt: null,
    prMergedAt: null,
    prUpdatedAt: new Date(TEST_NOW_MS - 1_000),
    mappedAt: new Date(TEST_NOW_MS - 1_000),
    lastCheckedAt: new Date(TEST_NOW_MS - 1_000),
    ...overrides,
  };
}

export function sessionEventRecord(
  overrides: Partial<CodingAgentSessionEventRecord> = {},
): CodingAgentSessionEventRecord {
  return codingAgentSessionEventRecordSchema.parse({
    tenantId: "project-1",
    sessionId: "session-1",
    timeUnixMs: TEST_NOW_MS - 1_000,
    recordId: "event-1",
    eventKind: "model_call",
    agent: "claude_code",
    sessionKeySource: "provider",
    traceId: "trace-1",
    spanId: "span-1",
    promptId: "",
    querySource: "",
    agentType: "",
    eventSequence: 1,
    requestId: "request-1",
    model: "claude-3",
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    costUsd: 0.5,
    durationMs: 10,
    ttftMs: 1,
    attempt: 1,
    speed: "",
    stopReason: "",
    preTokens: 0,
    postTokens: 0,
    compactionTrigger: "",
    precomputeReuse: "",
    statusCode: "",
    errorType: "",
    rateLimitCarrier: "",
    retryDurationMs: 0,
    toolName: "",
    success: "",
    decision: "",
    decisionSource: "",
    toolInputBytes: 0,
    toolResultBytes: 0,
    promptChars: 0,
    totalTokens: 10,
    ...overrides,
  });
}

export class TestClock extends CodingAgentClockPort {
  constructor(private value = TEST_NOW_MS) {
    super();
  }

  nowMs(): number {
    return this.value;
  }

  set(value: number): void {
    this.value = value;
  }
}

export class TestSessions extends CodingAgentSessionRepository {
  rows: CodingAgentSession[] = [];
  recentRowsByTenant = new Map<string, CodingAgentSession[]>();
  branchRows: CodingAgentSessionBranchRecord[] = [];
  missWhenWindowed = false;
  findInputs: Array<{
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }> = [];
  recentInputs: Array<{
    tenantId: string;
    userId?: string;
    fromMs: number;
    toMs: number;
    limit: number;
  }> = [];
  branchInputs: Array<{
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }> = [];
  stored: Array<{
    row: CodingAgentSession;
    retentionDays: number;
    appliedEventIds: readonly string[];
  }> = [];
  storedBatches: Array<
    Array<{
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }>
  > = [];
  applied: { row: CodingAgentSession; appliedEventIds: string[] } | null = null;

  async upsert(
    row: CodingAgentSession,
    retentionDays: number,
    appliedEventIds: readonly string[],
  ): Promise<void> {
    this.stored.push({ row, retentionDays, appliedEventIds });
  }

  async upsertBatch(
    rows: Array<{
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }>,
  ): Promise<void> {
    this.storedBatches.push(rows);
  }

  async tryFindBySessionId(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<CodingAgentSession | null> {
    this.findInputs.push(input);
    if (this.missWhenWindowed && input.window !== undefined) return null;
    return (
      this.rows.find(
        (row) => row.tenantId === input.tenantId && row.sessionId === input.sessionId,
      ) ?? null
    );
  }

  async tryFindBySessionIdWithApplied(): Promise<{
    row: CodingAgentSession;
    appliedEventIds: string[];
  } | null> {
    return this.applied;
  }

  async findManyRecent(input: {
    tenantId: string;
    userId?: string;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSession[]> {
    this.recentInputs.push(input);
    return this.recentRowsByTenant.get(input.tenantId) ?? this.rows;
  }

  async listByRepositoryBranch(input: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentSessionBranchRecord[]> {
    this.branchInputs.push(input);
    return this.branchRows;
  }
}

export class TestTraceSessions extends CodingAgentTraceSessionRepository {
  mapping: CodingAgentTraceSessionRecord | null = null;
  inputs: Array<{ tenantId: string; traceId: string }> = [];

  async ensure(): Promise<void> {}

  async tryFindByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<CodingAgentTraceSessionRecord | null> {
    this.inputs.push(input);
    return this.mapping;
  }
}

export class TestMetricSeries extends SessionMetricSeriesRepository {
  totals: SessionMetricTotal[] = [];
  inputs: Array<{
    tenantId: string;
    sessionIds: string[];
    fromMs: number;
    toMs: number;
  }> = [];

  async ensure(): Promise<void> {}

  async findTotalsBySessionIds(input: {
    tenantId: string;
    sessionIds: string[];
    fromMs: number;
    toMs: number;
  }): Promise<SessionMetricTotal[]> {
    this.inputs.push(input);
    return this.totals;
  }
}

export class TestEvents extends CodingAgentSessionEventRepository {
  page: { events: CodingAgentSessionEvent[]; nextCursor: null } = {
    events: [],
    nextCursor: null,
  };
  pages: Array<{ events: CodingAgentSessionEvent[]; nextCursor: null }> = [];
  inputs: Array<{
    tenantId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: { timeUnixMs: number; recordId: string };
    limit: number;
  }> = [];
  modelTotals: Array<{
    tenantId: string;
    sessionId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
  }> = [];
  modelTotalInputs: Array<{
    tenantIds: string[];
    sessionIds: string[];
    fromMs: number;
  }> = [];

  async ensure(): Promise<void> {}

  async findBySessionId(input: {
    tenantId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: { timeUnixMs: number; recordId: string };
    limit: number;
  }): Promise<{ events: CodingAgentSessionEvent[]; nextCursor: null }> {
    this.inputs.push(input);
    return this.pages.shift() ?? this.page;
  }

  async sumTokensByModelPerSession(input: {
    tenantIds: string[];
    sessionIds: string[];
    fromMs: number;
  }): Promise<
    Array<{
      tenantId: string;
      sessionId: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      costUsd: number;
    }>
  > {
    this.modelTotalInputs.push(input);
    return this.modelTotals;
  }
}

export class TestBillingPolicy extends CodingAgentBillingPolicyPort {
  nonBillableAgents = new Set<string>();

  async isSourceNonBillable(input: {
    sourceType: string;
  }): Promise<boolean> {
    return this.nonBillableAgents.has(input.sourceType);
  }
}

export class TestGithubService extends GithubService {
  readonly configured = true;
  pullRequests: GithubPullRequest[] = [];
  mappingRequests: Array<{
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }> = [];
  branchLookupInputs: Array<{
    organizationId: string;
    keys: ReadonlyArray<{
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }>;
  }> = [];
  coveredRepositories = true;
  mappingError: Error | null = null;

  static create(): TestGithubService {
    return new TestGithubService();
  }

  getAppConfig(): never {
    throw new Error("not used by Coding Agent tests");
  }

  getWebBase(): never {
    throw new Error("not used by Coding Agent tests");
  }

  normalizeRepositoryHost(repositoryHost: string): string {
    return repositoryHost.toLowerCase() || "github.com";
  }

  canMapRepositoryHost(repositoryHost: string): boolean {
    return this.normalizeRepositoryHost(repositoryHost) === "github.com";
  }

  getAppInstallUrl(): never {
    throw new Error("not used by Coding Agent tests");
  }

  getInstallStateTtlMs(): never {
    throw new Error("not used by Coding Agent tests");
  }

  async registerInstallNonce(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async tryConsumeInstallNonce(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  signInstallState(): never {
    throw new Error("not used by Coding Agent tests");
  }

  tryVerifyInstallState(): never {
    throw new Error("not used by Coding Agent tests");
  }

  popupResponseHtml(): never {
    throw new Error("not used by Coding Agent tests");
  }

  popupErrorHtml(): never {
    throw new Error("not used by Coding Agent tests");
  }

  tryParsePullRequestEvent(): never {
    throw new Error("not used by Coding Agent tests");
  }

  async getAllForOrganization(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async tryGetByInstallationId(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async isOrganizationMember(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async getConnectionStatus(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async disconnect(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async recordInstallation(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async handleWebhookEvent(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async listRepositoriesForOrganization(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async tryMintTurnToken(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async coversRepository(): Promise<boolean> {
    return this.coveredRepositories;
  }

  async requestBranchMapping(input: {
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }): Promise<void> {
    this.mappingRequests.push(input);
    if (this.mappingError !== null) throw this.mappingError;
  }

  async getLivePullRequestStatuses(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async applyPullRequestEvent(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async findForBranches(input: {
    organizationId: string;
    keys: ReadonlyArray<{
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }>;
  }): Promise<readonly GithubPullRequest[]> {
    this.branchLookupInputs.push(input);
    return this.pullRequests;
  }

  async findAllByBranches(): Promise<readonly GithubPullRequest[]> {
    return this.pullRequests;
  }

  async tryFindByNumber(input: { prNumber: number }): Promise<GithubPullRequest | null> {
    return this.pullRequests.find((pullRequest) => pullRequest.prNumber === input.prNumber) ?? null;
  }

  async recheckDueBranches(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async pruneStaleBranchLinkage(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }
}

export class TestProjectService extends ProjectService {
  projects: Array<{ id: string }> = [];
  sessionActivity: Array<{ projectId: string; at: Date }> = [];
  sessionActivityError: Error | null = null;
  organizationId = "organization-1";
  teamProject: ProjectWithTeam | null = projectWithTeamSchema.parse({
    id: "project-1",
    name: "Project",
    slug: "project",
    apiKey: "key",
    lwqlKey: "lwql",
    teamId: "team-1",
    language: "typescript",
    framework: "",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: true,
    ownerUserId: "user-1",
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: {
      id: "team-1",
      name: "Team",
      slug: "team",
      organizationId: "organization-1",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      archivedAt: null,
      isPersonal: true,
      ownerUserId: "user-1",
      departmentId: null,
    },
  });

  async tryFindInternal(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async ensureInternal(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async isPresenceEnabled(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async getById(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async getOrganizationId(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async tryGetIdentity(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async tryGetById(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async tryGetSummaryById(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async getWithTeam(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async tryGetWithTeam(): Promise<ProjectWithTeam | null> {
    return this.teamProject;
  }

  async create(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async update(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async archive(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async listByOrganization(): Promise<{ data: Array<{ id: string }> }> {
    return { data: this.projects };
  }

  async listByTeam(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async listNamesByIds(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async listIdsByOrganization(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async listActiveByScopes(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async updateMetadata(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async touchCodingAgentSessionSeen(input: {
    projectId: string;
    at: Date;
  }): Promise<void> {
    if (this.sessionActivityError) {
      throw this.sessionActivityError;
    }

    this.sessionActivity.push(input);
  }

  async touchCodingAgentPullRequestSeen(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async searchByQuery(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async tryGetTraceSharingConfig(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async resolveOrgAdmin(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async resolveTraceDestination(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async tryGetTraceDestination(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async listTraceDestinations(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }
}
