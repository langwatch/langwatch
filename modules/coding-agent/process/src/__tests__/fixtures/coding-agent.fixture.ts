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
import { type Authorization, sealAuthorization } from "@langwatch/authorization";
import {
  type ClickHouseQueryClient,
  fenceFor,
  type InsertRequest,
  type QueryDriver,
  type QueryRequest,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  readyIdIndexedClientDouble,
} from "@langwatch/clickhouse-client/testing";
import { createServer, type Server } from "node:http";
import {
  type GithubApi,
  type GithubPullRequest,
} from "@langwatch/github-contract";
import {
  type PaginatedProjects,
  type ProjectApi,
  type ProjectIdentity,
  projectWithTeamSchema,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { CodingAgentBillingPolicy } from "../../services/coding-agent-cost-attribution.service.ts";
import type { CodingAgentClock } from "../../services/coding-agent-clock.service.ts";
import { CODING_AGENT_ID_INDEXES } from "../../repositories/clickhouse/clickhouse.coding-agent-id-indexes.database.ts";
import { CodingAgentSessionEventRepository } from "../../repositories/coding-agent-session-event.repository.ts";
import {
  CodingAgentSessionRepository,
  type OtherSessionKind,
} from "../../repositories/coding-agent-session.repository.ts";
import { CodingAgentTraceSessionRepository } from "../../repositories/coding-agent-trace-session.repository.ts";
import {
  SessionMetricSeriesRepository,
  type SessionMetricTotal,
} from "../../repositories/session-metric-series.repository.ts";

export const TEST_NOW_MS = CODING_AGENT_TEST_NOW_MS;

type ClickHouseRequest = { url: string; body: string };

/**
 * A typed local ClickHouse wire fixture for package runtime-adapter tests.
 * Stands in for the process's ONE client, not a resolver: repositories name
 * their tenant on every statement, and the guard below refuses one that cannot.
 */
export class TestClickHouseEndpoint {
  /** The process's one client, pointed at this endpoint. */
  readonly clickhouse: ClickHouseQueryClient;

  private constructor(
    private readonly server: Server,
    private readonly client: ClickHouseClient,
    readonly requests: ClickHouseRequest[],
    readonly queryRows: Record<string, unknown>[][],
    clickhouse: ClickHouseQueryClient,
  ) {
    this.clickhouse = clickhouse;
  }

  /**
   * An endpoint whose client declares coding-agent's id indexes: not filled by default, so a
   * read by id takes today's path; `idIndexReady` reads them as filled, without asking the server.
   */
  static async create({
    idIndexReady = false,
  }: { idIndexReady?: boolean } = {}): Promise<TestClickHouseEndpoint> {
    const requests: ClickHouseRequest[] = [];
    const queryRows: Record<string, unknown>[][] = [];
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
    const client = createClient({ url: `http://127.0.0.1:${address.port}` });
    const driver = singleEndpointDriver(client);
    const clickhouse = idIndexReady
      ? await readyIdIndexedClientDouble({ indexes: CODING_AGENT_ID_INDEXES, driver })
      : idIndexedClientDouble({ indexes: CODING_AGENT_ID_INDEXES, driver });
    return new TestClickHouseEndpoint(server, client, requests, queryRows, clickhouse);
  }

  async close(): Promise<void> {
    await this.client.close();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

/**
 * The one endpoint this fixture opened, as a driver. Real routing lives in
 * `@langwatch/process-stores`; a fixture reaches one server, so this places
 * every statement on it whatever tenant it named.
 */
function singleEndpointDriver(client: ClickHouseClient): QueryDriver {
  return {
    async execute<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json<Row>() };
    },

    async insert(request: InsertRequest): Promise<void> {
      await client.insert({
        table: request.table,
        values: request.rows as Record<string, unknown>[],
        format: "JSONEachRow",
        ...(request.settings === undefined
          ? {}
          : { clickhouse_settings: request.settings as Record<string, never> }),
      });
    },

    async command(request: QueryRequest): Promise<void> {
      await client.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
}

export function session(overrides: Partial<CodingAgentSession> = {}): CodingAgentSession {
  return codingAgentSessionFixture(overrides);
}

const TEST_ACTOR = { type: "user", id: "test-user" } as const;
const TEST_PROOF_LIFETIME_MS = 5 * 60 * 1000;

/** The proof a plain project's route mints: one own grant, nothing shared (ADR-177). */
export function ownProof({
  projectId,
  now = Date.now(),
}: {
  projectId: string;
  now?: number;
}): Authorization {
  return sealAuthorization({
    actor: TEST_ACTOR,
    principal: TEST_ACTOR,
    scope: { organizationId: "test-organization" },
    grants: [{ projectId, permissions: ["traces:view"], via: [], kind: "own" }],
    expiresAt: now + TEST_PROOF_LIFETIME_MS,
    purpose: { kind: "route", route: "test" },
  });
}

/** An aggregate's proof: own on the aggregate, one shared grant per member with its window. */
export function aggregateProof({
  projectId,
  members,
  now = Date.now(),
}: {
  projectId: string;
  members: { projectId: string; from: number; until?: number | null }[];
  now?: number;
}): Authorization {
  return sealAuthorization({
    actor: TEST_ACTOR,
    principal: TEST_ACTOR,
    scope: { organizationId: "test-organization" },
    grants: [
      { projectId, permissions: ["traces:view"], via: [], kind: "own" },
      ...members.map((member, index) => ({
        projectId: member.projectId,
        permissions: ["traces:view"],
        via: [`grant_${index}`],
        kind: "shared" as const,
        condition: { type: "trace" as const, from: member.from, until: member.until ?? null },
      })),
    ],
    expiresAt: now + TEST_PROOF_LIFETIME_MS,
    purpose: { kind: "route", route: "test" },
  });
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
    usageByContext: [],
    usageByModel: [],
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
    // The working context the contribute command stamps on. '' is what a row
    // carries before the session declared one, which is the shape these
    // suites read.
    repositoryHost: "",
    repositoryOwner: "",
    repositoryName: "",
    branch: "",
    ...overrides,
  });
}

export class TestClock implements CodingAgentClock {
  constructor(private value = TEST_NOW_MS) {
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
  bySessionIdRows: CodingAgentSessionBranchRecord[] = [];
  bySessionIdInputs: {
    tenantIds: string[];
    sessionIds: string[];
    startedAtFromMs: number;
  }[] = [];
  missWhenWindowed = false;
  findInputs: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }[] = [];
  recentInputs: {
    tenantId: string;
    userId?: string;
    fromMs: number;
    toMs: number;
    limit: number;
  }[] = [];
  fencedInputs: {
    authorization: Authorization;
    fromMs: number;
    toMs: number;
    limit: number;
  }[] = [];
  branchInputs: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }[] = [];
  stored: {
    row: CodingAgentSession;
    retentionDays: number;
    appliedEventIds: readonly string[];
  }[] = [];
  storedBatches: {
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }[][] = [];
  applied: { row: CodingAgentSession; appliedEventIds: string[] } | null = null;

  async upsert(
    row: CodingAgentSession,
    retentionDays: number,
    appliedEventIds: readonly string[],
  ): Promise<void> {
    this.stored.push({ row, retentionDays, appliedEventIds });
  }

  async upsertBatch(
    rows: {
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }[],
  ): Promise<void> {
    this.storedBatches.push(rows);
  }

  async findBySessionId(input: {
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

  async findBySessionIdWithApplied(): Promise<{
    row: CodingAgentSession;
    appliedEventIds: string[];
  } | null> {
    return this.applied;
  }

  async findOtherSessionKind(input: {
    tenantId: string;
    excludeSessionIds: string[];
  }): Promise<OtherSessionKind> {
    const others = this.rows.filter(
      (row) => row.tenantId === input.tenantId && !input.excludeSessionIds.includes(row.sessionId),
    );
    if (others.some((row) => !row.auxiliary)) return "main";
    return others.length > 0 ? "helpers_only" : "none";
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

  /** The fence applied in memory: own rows whole, a shared tenant's rows cut to its window. */
  async findManyRecentFenced(input: {
    authorization: Authorization;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSession[]> {
    this.fencedInputs.push(input);
    const fence = fenceFor({ authorization: input.authorization, reads: "traces" });
    const rowsOf = (tenantId: string) => this.recentRowsByTenant.get(tenantId) ?? this.rows;
    const own = fence.own.flatMap((tenantId) =>
      rowsOf(tenantId).filter((row) => row.tenantId === tenantId),
    );
    const shared = fence.shared.flatMap((window) =>
      rowsOf(window.projectId).filter(
        (row) =>
          row.tenantId === window.projectId &&
          row.startedAtMs >= window.from &&
          (window.until === null || row.startedAtMs < window.until),
      ),
    );
    return [...own, ...shared]
      .filter((row) => row.startedAtMs >= input.fromMs && row.startedAtMs <= input.toMs)
      .slice(0, input.limit);
  }

  async findByRepositoryBranch(input: {
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

  async findBySessionIds(input: {
    tenantIds: string[];
    sessionIds: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentSessionBranchRecord[]> {
    this.bySessionIdInputs.push(input);
    return this.bySessionIdRows;
  }

  async countUsage(): Promise<{ sessions: number }> {
    return { sessions: this.rows.length };
  }
}

export class TestTraceSessions extends CodingAgentTraceSessionRepository {
  mapping: CodingAgentTraceSessionRecord | null = null;
  inputs: { tenantId: string; traceId: string }[] = [];

  async ensure(): Promise<void> {}

  async findByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<CodingAgentTraceSessionRecord | null> {
    this.inputs.push(input);
    return this.mapping;
  }
}

export class TestMetricSeries extends SessionMetricSeriesRepository {
  totals: SessionMetricTotal[] = [];
  inputs: {
    tenantId: string;
    sessionIds: string[];
    fromMs: number;
    toMs: number;
  }[] = [];

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
  pages: { events: CodingAgentSessionEvent[]; nextCursor: null }[] = [];
  inputs: {
    tenantId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: { timeUnixMs: number; recordId: string };
    limit: number;
  }[] = [];
  modelTotals: {
    tenantId: string;
    sessionId: string;
    model: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branch: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
  }[] = [];
  modelTotalInputs: {
    tenantIds: string[];
    sessionIds: string[];
    fromMs: number;
  }[] = [];
  stampedSessions: { tenantId: string; sessionId: string }[] = [];
  stampedInputs: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    fromMs: number;
  }[] = [];

  async ensure(): Promise<void> {}

  async listBySessionId(input: {
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
    {
      tenantId: string;
      sessionId: string;
      model: string;
      repositoryHost: string;
      repositoryOwner: string;
      repositoryName: string;
      branch: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      costUsd: number;
    }[]
  > {
    this.modelTotalInputs.push(input);
    return this.modelTotals;
  }

  async findSessionsByStampedBranch(input: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    fromMs: number;
  }): Promise<{ tenantId: string; sessionId: string }[]> {
    this.stampedInputs.push(input);
    return this.stampedSessions;
  }
}

export class TestBillingPolicy implements CodingAgentBillingPolicy {
  nonBillableAgents = new Set<string>();

  async isSourceNonBillable(input: {
    sourceType: string;
  }): Promise<boolean> {
    return this.nonBillableAgents.has(input.sourceType);
  }
}

export class TestGithubService implements GithubApi {
  countUsage(): Promise<{ pullRequests: number }> {
    return Promise.resolve({ pullRequests: 0 });
  }

  branchQueries: { headBranches: readonly string[] }[] = [];
  readonly configured = true;
  pullRequests: GithubPullRequest[] = [];
  mappingRequests: {
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }[] = [];
  branchLookupInputs: {
    organizationId: string;
    keys: readonly {
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }[];
  }[] = [];
  coveredRepositories = true;
  mappingError: Error | null = null;

  static create(): TestGithubService {
    return new TestGithubService();
  }

  getAppConfig(): never {
    throw new Error("not used by Coding Agent tests");
  }

  getWebBase(): string {
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

  async consumeInstallNonce(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  signInstallState(): never {
    throw new Error("not used by Coding Agent tests");
  }

  parseInstallState(): never {
    throw new Error("not used by Coding Agent tests");
  }

  popupResponseHtml(): never {
    throw new Error("not used by Coding Agent tests");
  }

  popupErrorHtml(): never {
    throw new Error("not used by Coding Agent tests");
  }



  async getAllForOrganization(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async findByInstallationId(): Promise<never> {
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


  async listRepositoriesForOrganization(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async findTurnTokens(): Promise<never> {
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



  async findForBranches(input: {
    organizationId: string;
    keys: readonly {
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }[];
  }): Promise<readonly GithubPullRequest[]> {
    this.branchLookupInputs.push(input);
    return this.pullRequests;
  }

  // Declares the input the contract passes, so a test that replaces this with
  // a mock and then asserts the lookup key is asserting against the real
  // signature rather than a zero-argument stand-in.
  async findAllByBranches(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranches: readonly string[];
  }): Promise<readonly GithubPullRequest[]> {
    this.branchQueries.push(input);
    return this.pullRequests;
  }

  async findByNumber(input: { prNumber: number }): Promise<GithubPullRequest | null> {
    return this.pullRequests.find((pr) => pr.prNumber === input.prNumber) ?? null;
  }

  async recheckDueBranches(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }

  async pruneStaleBranchLinkage(): Promise<never> {
    throw new Error("not used by Coding Agent tests");
  }
}

export function projectRow(
  id: string,
  overrides: Partial<PaginatedProjects["data"][number]> = {},
): PaginatedProjects["data"][number] {
  const at = new Date(0);
  return {
    id,
    name: id,
    slug: id,
    apiKey: "",
    lwqlKey: "",
    teamId: "team-1",
    language: "other",
    framework: "other",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: at,
    updatedAt: at,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    ...overrides,
  };
}

function projectIdentity({ id, name }: { id: string; name: string }): ProjectIdentity {
  return {
    id,
    name,
    slug: id,
    teamId: "team-1",
    organizationId: "organization-1",
    isPersonal: false,
    ownerUserId: null,
    kind: "application",
  };
}

export interface TestProjectState {
  projects: { id: string }[];
  /** The names `listNamesByIds` answers with; an id left out has no live project. */
  readonly projectNames: Map<string, string>;
  readonly nameLookups: { projectIds: string[] }[];
  readonly sessionActivity: { projectId: string; at: Instant }[];
  teamProject: ProjectWithTeam | null;
}

export type TestProjects = ProjectApi & TestProjectState;

/** The ProjectApi reads coding-agent makes; a suite adds any other it needs. */
export function createTestProjects(overrides: Partial<ProjectApi> = {}): TestProjects {
  const projects: TestProjects = Object.assign<ProjectApi, TestProjectState>(
    createApiFixture<ProjectApi>(
      {
        findWithTeam: () => Promise.resolve(projects.teamProject),
        listByOrganization: (): Promise<PaginatedProjects> =>
          Promise.resolve({
            data: projects.projects.map(({ id }) => projectRow(id)),
            pagination: { page: 1, limit: projects.projects.length, total: projects.projects.length },
          }),
        touchCodingAgentSessionSeen: (input) => {
          projects.sessionActivity.push(input);
          return Promise.resolve();
        },
        listNamesByIds: (input) => {
          projects.nameLookups.push(input);
          return Promise.resolve(
            input.projectIds.flatMap((id) => {
              const name = projects.projectNames.get(id);
              return name === undefined ? [] : [projectIdentity({ id, name })];
            }),
          );
        },
        ...overrides,
      },
      "ProjectApi",
    ),
    {
      projects: [],
      projectNames: new Map(),
      nameLookups: [],
      sessionActivity: [],
      teamProject: projectWithTeamSchema.parse({
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
}),
    },
  );
  return projects;
}
