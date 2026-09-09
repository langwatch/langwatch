import type { CodingAgentSessionLookupInput } from "@langwatch/coding-agent-contract";
/** The coding-agent application shared by all transports. */
import type {
  CodingAgentApi,
  CodingAgentGithubConnection,
  CodingAgentPersonalPullRequestUsage,
  CodingAgentPersonalPullRequestUsageInput,
  CodingAgentPullRequestDetail,
  CodingAgentPullRequestMappingBackfillInput,
  CodingAgentPullRequestUsage,
  CodingAgentRecentSessionsInput,
  CodingAgentService,
  CodingAgentSession,
  CodingAgentSessionEvent,
  CodingAgentSessionEventsInput,
  CodingAgentSessionListRow,
  CodingAgentSessionsListInput,
  CodingAgentSessionCursor,
  CodingAgentUsageTotals,
  CodingAgentUsageTotalsInput,
} from "@langwatch/coding-agent-contract";
import type { SpanDetail } from "@langwatch/trace-contract";
import type { TranscriptLogRecord } from "@langwatch/coding-agent-contract";
import { CodingAgentApi as CodingAgentApiToken } from "@langwatch/coding-agent-contract";
import { GithubApi } from "@langwatch/github-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { GithubPullRequestNotMappedError } from "@langwatch/github-contract";
import type {
  CodingAgentPullRequestUsageRead,
  CodingAgentViewer,
} from "@langwatch/coding-agent-contract";
import type { CodingAgentScopeCaller } from "#ports/coding-agent-caller-scope.port";
import type { CodingAgentClickHousePort } from "#ports/coding-agent-clickhouse.port";
import type { CodingAgentBillingPolicyPort } from "#ports/coding-agent-billing.port";
import {
  gatePullRequestSessionTitles,
  gateSessionListCost,
  gateSessionListTitles,
} from "../rules/coding-agent-gates.rules.ts";
import { CodingAgentCallerScopeService } from "../services/coding-agent-caller-scope.service.ts";
import {
  CodingAgentProjectionPersistenceAdapter,
  CodingAgentRuntime,
} from "../adapters/coding-agent.adapter.ts";
import type {
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentScopePermissionsPort,
} from "../ports/coding-agent-caller-scope.port.ts";

/**
 * The caller's permission cut over an organization: which of its projects they
 * may read, which of those they may also price, and how each is named to them.
 *
 * Derived from the service's own input rather than restated, so this and the
 * service cannot drift into disagreement about what a scope is. One
 * declaration, because two doors used to carry one each.
 */
export type CodingAgentCallerScope = Pick<
  CodingAgentPersonalPullRequestUsageInput,
  "permittedProjectIds" | "costProjectIds" | "projects"
>;

/** Who a cross-project read is answered for. */
export interface CodingAgentCaller {
  readonly id: string;
}

/** One pull request, addressed the way both doors address it. */
export interface CodingAgentPullRequestRef {
  projectId: string;
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
}

/** The process capabilities this feature needs that are not coding-agent's own. */
export interface CodingAgentScopePorts {
  /**
   * The organization a project belongs to, or undefined for an orphan project.
   * Derived here rather than taken from the client, so a caller cannot ask
   * about another tenant's pull requests by naming its id.
   */
  findOrganizationForProject(projectId: string): Promise<string | undefined>;
  /**
   * The organization's projects split by what one caller may do with each.
   *
   * Enumerated from the organization rather than taken from the request: a
   * caller that could name the projects to count could count one it may not
   * read.
   */
  resolveCallerProjectScope(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
  }): Promise<CodingAgentCallerScope>;
}

/** What one viewer may see of one project: the generated titles travel under content visibility. */
export type CodingAgentViewerVisibility = Readonly<{
  canReadCapturedContent: boolean;
  canSeeCosts: boolean;
}>;

/** Resolves one viewer's protections over one project; throws when the policy cannot be resolved. */
export interface CodingAgentViewerVisibilityPort {
  readVisibility(input: { userId: string; projectId: string }): Promise<CodingAgentViewerVisibility>;
}

/** Where a read that names people is written down; the application builds the entry. */
export interface CodingAgentAuditPort {
  auditLog(entry: {
    userId: string;
    organizationId: string;
    action: string;
    targetKind: string;
    targetId: string;
    args: Record<string, unknown>;
  }): Promise<void>;
}

/** What the process composes this feature's application from. */
export type CodingAgentInfrastructure = Readonly<{
  clickHouse: CodingAgentClickHousePort | null;
  defaultTraceRetentionDays: number;
  billing: CodingAgentBillingPolicyPort;
  scopeDirectory: CodingAgentCallerScopeDirectoryPort;
  scopePermissions: CodingAgentScopePermissionsPort;
  /** What one viewer may read of one project's captured content and spend. */
  visibility: CodingAgentViewerVisibilityPort;
  /** Where a read that names people is written down. */
  audit: CodingAgentAuditPort;
  /** Test-only service seam; production composition leaves this absent. */
  service?: CodingAgentService;
}>;

type CodingAgentDependencies = { projects: typeof ProjectApi; github: typeof GithubApi };
type CodingAgentSetup = FeatureSetup<CodingAgentDependencies, CodingAgentInfrastructure, undefined>;

export class CodingAgentApp implements CodingAgentApi {
  static readonly contract = CodingAgentApiToken;
  static readonly dependencies: CodingAgentDependencies = {
    projects: ProjectApi,
    github: GithubApi,
  };

  static create({ infrastructure, dependencies }: CodingAgentSetup): CodingAgentApp {
    const projections = CodingAgentProjectionPersistenceAdapter.create({
      clickHouse: infrastructure.clickHouse,
      retention: { defaultTraceRetentionDays: infrastructure.defaultTraceRetentionDays },
    });
    const service =
      infrastructure.service ??
      CodingAgentRuntime.create({
        projections,
        github: dependencies.github,
        projects: dependencies.projects,
        billing: infrastructure.billing,
      }).service;
    const scopeService = CodingAgentCallerScopeService.create({
      directory: infrastructure.scopeDirectory,
      permissions: infrastructure.scopePermissions,
    });
    const scope: CodingAgentScopePorts = {
      findOrganizationForProject: async (projectId: string) => {
        try {
          return await dependencies.projects.getOrganizationId(projectId);
        } catch {
          return undefined;
        }
      },
      resolveCallerProjectScope: (input) => scopeService.resolve(input),
    };
    return new CodingAgentApp(service, dependencies.github, scope, infrastructure);
  }

  readonly #codingAgents: CodingAgentService;
  readonly #github: GithubApi;
  readonly #scope: CodingAgentScopePorts;
  readonly #visibility: CodingAgentViewerVisibilityPort;
  readonly #audit: CodingAgentAuditPort;

  private constructor(
    codingAgents: CodingAgentService,
    github: GithubApi,
    scope: CodingAgentScopePorts,
    infrastructure: CodingAgentInfrastructure,
  ) {
    this.#codingAgents = codingAgents;
    this.#github = github;
    this.#scope = scope;
    this.#visibility = infrastructure.visibility;
    this.#audit = infrastructure.audit;
  }

  logContentKeys(eventName: string) {
    return this.#codingAgents.logContentKeys(eventName);
  }

  contentAttrKeys(eventName: string) {
    return this.#codingAgents.contentAttrKeys(eventName);
  }

  shouldFilterSpan(input: {
    scopeName: string | null | undefined;
    spanName: string;
    attributeKeys: readonly string[];
  }): boolean {
    return this.#codingAgents.shouldFilterSpan(input);
  }

  buildTranscript(input: { spans: SpanDetail[]; logs: TranscriptLogRecord[] }) {
    return this.#codingAgents.buildTranscript(input);
  }

  findBySessionId(input: CodingAgentSessionLookupInput) {
    return this.#codingAgents.findBySessionId(input);
  }

  findSessionForTrace(input: { projectId: string; traceId: string }) {
    return this.#codingAgents.findSessionForTrace(input);
  }

  linkTraceSessionsToPullRequests(
    input: Parameters<CodingAgentService["linkTraceSessionsToPullRequests"]>[0],
  ) {
    return this.#codingAgents.linkTraceSessionsToPullRequests(input);
  }

  /** One session's event sequence, in time order, keyset-paginated. */
  getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }> {
    return this.#codingAgents.getSessionEvents(input);
  }

  /** The project's "at a glance" totals over a window. */
  getUsageTotals(input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals> {
    return this.#codingAgents.getUsageTotals(input);
  }

  /** The project's recent sessions in a window, newest first. */
  listRecent(input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]> {
    return this.#codingAgents.listRecent(input);
  }

  /**
   * The installation follow-up: the branches this organization's own sessions
   * already named, mapped against the connection just made. Fire-and-forget at
   * its caller, and fail-open — the branch recheck rebuilds the same mapping.
   */
  backfillPullRequestMappings(input: CodingAgentPullRequestMappingBackfillInput): Promise<void> {
    return this.#codingAgents.backfillPullRequestMappings(input);
  }

  /**
   * The Sessions screen's rows for one project, cut to what this viewer may
   * see: the title is the one conversation-derived value on the row, so it
   * follows content visibility, and the cost follows `cost:view`.
   */
  async listForProject(
    input: CodingAgentSessionsListInput,
    by: CodingAgentViewer,
  ): Promise<CodingAgentSessionListRow[]> {
    const visibility = await this.#visibility.readVisibility({
      userId: by.id,
      projectId: input.projectId,
    });
    const rows = await this.#codingAgents.listForProject(input);

    return gateSessionListCost({
      rows: gateSessionListTitles({
        rows,
        canReadCapturedContent: visibility.canReadCapturedContent,
      }),
      canSeeCosts: visibility.canSeeCosts,
    });
  }

  /**
   * Records who read an answer that names people. Awaited by its callers before
   * the answer leaves, so a read is never served unrecorded.
   */
  async recordPullRequestUsageRead(read: CodingAgentPullRequestUsageRead): Promise<void> {
    await this.#audit.auditLog({
      userId: read.readerUserId,
      organizationId: read.organizationId,
      action: "codingAgents.pullRequestUsage",
      targetKind: "pullRequest",
      targetId: `${read.repositoryHost}/${read.repositoryFullName}#${read.prNumber}`,
      args: {
        repository: read.repositoryFullName,
        host: read.repositoryHost,
        pullRequest: read.prNumber,
        contributingProjectCount: read.contributingProjectCount,
      },
    });
  }

  /** The GitHub web origin this instance is bound to. */
  githubWebBase(): string {
    return this.#github.getWebBase();
  }

  /** The organization a project belongs to, or undefined for an orphan. */
  findOrganizationForProject(projectId: string): Promise<string | undefined> {
    return this.#scope.findOrganizationForProject(projectId);
  }

  /** Reads pull-request usage across the caller's permitted projects. */
  async getPullRequestUsage(
    pullRequest: CodingAgentPullRequestRef,
    by: CodingAgentScopeCaller,
  ): Promise<{ usage: CodingAgentPullRequestUsage; organizationId: string }> {
    const organizationId = await this.requireOrganizationFor(pullRequest);
    const scope = await this.#scope.resolveCallerProjectScope({
      caller: by,
      organizationId,
    });
    const usage = await this.#codingAgents.getPullRequestUsage({
      organizationId,
      repositoryHost: pullRequest.repositoryHost,
      repositoryFullName: pullRequest.repositoryFullName,
      prNumber: pullRequest.prNumber,
      ...scope,
    });
    return { usage, organizationId };
  }

  /** Reads pull-request usage when the organization is already known. */
  async getOrganizationPullRequestUsage(
    pullRequest: {
      organizationId: string;
      repositoryHost: string;
      repositoryFullName: string;
      prNumber: number;
    },
    by: CodingAgentScopeCaller,
  ): Promise<CodingAgentPullRequestUsage> {
    const scope = await this.#scope.resolveCallerProjectScope({
      caller: by,
      organizationId: pullRequest.organizationId,
    });
    return this.#codingAgents.getPullRequestUsage({
      organizationId: pullRequest.organizationId,
      repositoryHost: pullRequest.repositoryHost,
      repositoryFullName: pullRequest.repositoryFullName,
      prNumber: pullRequest.prNumber,
      ...scope,
    });
  }

  /**
   * One pull request in full: totals, contributors, models and sessions. Each
   * session's title is resolved against the project it ran in, because the
   * detail spans an organization and a reader can be trusted with one
   * project's conversations and not another's.
   */
  async getPullRequestDetail(
    pullRequest: CodingAgentPullRequestRef,
    by: CodingAgentCaller,
  ): Promise<CodingAgentPullRequestDetail> {
    const organizationId = await this.requireOrganizationFor(pullRequest);
    const scope = await this.#scope.resolveCallerProjectScope({
      caller: { kind: "user", userId: by.id },
      organizationId,
    });
    const detail = await this.#codingAgents.getPullRequestDetail({
      organizationId,
      repositoryHost: pullRequest.repositoryHost,
      repositoryFullName: pullRequest.repositoryFullName,
      prNumber: pullRequest.prNumber,
      ...scope,
    });

    return {
      ...detail,
      sessions: gatePullRequestSessionTitles({
        sessions: detail.sessions,
        contentProjectIds: await this.contentProjectIdsFor({
          userId: by.id,
          projectIds: detail.sessions.map((session) => session.projectId),
        }),
      }),
    };
  }

  /** Reads personal pull-request usage and GitHub connection state. */
  async getPersonalProjectPullRequestUsage(
    input: { projectId: string },
    by: CodingAgentCaller,
  ): Promise<CodingAgentPersonalPullRequestUsage & { connection: CodingAgentGithubConnection }> {
    const organizationId = await this.#scope.findOrganizationForProject(input.projectId);
    const scope = organizationId
      ? await this.#scope.resolveCallerProjectScope({
          caller: { kind: "user", userId: by.id },
          organizationId,
        })
      : emptyCallerScope();

    const usage = await this.#codingAgents.getForPersonalProject({
      projectId: input.projectId,
      ...scope,
    });
    return { ...usage, connection: await this.githubConnection(organizationId) };
  }

  /**
   * Whether GitHub is connected for an organization, and the install URL when
   * it is not — null unless this instance actually has a GitHub App to install,
   * so the page never offers a link that leads nowhere.
   */
  async githubConnection(organizationId: string | undefined): Promise<CodingAgentGithubConnection> {
    if (!organizationId) return { connected: false, installUrl: null };

    const installations = await this.#github.getAllForOrganization(organizationId);
    const installable = Boolean(this.#github.getAppConfig().appSlug);
    return {
      connected: installations.length > 0,
      installUrl: installable
        ? `/api/github/install?organizationId=${encodeURIComponent(organizationId)}`
        : null,
    };
  }

  /**
   * Which of these projects the reader may read the captured content of, once
   * per distinct project and only for those that contributed a session. One
   * whose visibility cannot be resolved is absent, which hides its titles.
   */
  private async contentProjectIdsFor({
    userId,
    projectIds,
  }: {
    userId: string;
    projectIds: readonly string[];
  }): Promise<ReadonlySet<string>> {
    const distinct = [...new Set(projectIds)];
    const visible = await Promise.all(
      distinct.map(async (projectId) => {
        try {
          const visibility = await this.#visibility.readVisibility({ userId, projectId });
          return visibility.canReadCapturedContent ? projectId : null;
        } catch {
          return null;
        }
      }),
    );

    return new Set(visible.filter((projectId) => projectId !== null));
  }

  /** Resolves a pull-request project's organization or preserves the old error. */
  private async requireOrganizationFor(pullRequest: CodingAgentPullRequestRef): Promise<string> {
    const organizationId = await this.#scope.findOrganizationForProject(
      pullRequest.projectId,
    );
    if (organizationId) return organizationId;
    throw new GithubPullRequestNotMappedError({
      repositoryFullName: pullRequest.repositoryFullName,
      prNumber: pullRequest.prNumber,
    });
  }
}

/** Nothing readable, nothing priceable, nobody named. */
function emptyCallerScope(): CodingAgentCallerScope {
  return { permittedProjectIds: [], costProjectIds: [], projects: {} };
}
