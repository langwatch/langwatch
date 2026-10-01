import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import {
  type CodingAgentSessionLookupInput,
  type TranscriptLogRecord,
  buildCodingAgentTranscript,
  contentAttrKeys,
  type LogContentKey,
  logContentKeys,
  shouldFilterCodingAgentSpan,
  CodingAgentApi as CodingAgentApiToken,
  type CodingAgentPullRequestUsageRead,
  type CodingAgentViewer,
  type CodingAgentApi,
  type CodingAgentGithubConnection,
  type CodingAgentPersonalPullRequestUsage,
  type CodingAgentPersonalPullRequestUsageInput,
  type CodingAgentPullRequestDetail,
  type CodingAgentPullRequestMappingBackfillInput,
  type CodingAgentPullRequestUsage,
  type CodingAgentRecentSessionsInput,
  type CodingAgentSession,
  type CodingAgentSessionEvent,
  type CodingAgentSessionEventsInput,
  type CodingAgentSessionListRow,
  type CodingAgentSessionsListInput,
  type CodingAgentSessionCursor,
  type CodingAgentSpanFilterInput,
  type CodingAgentUsageCount,
  type CodingAgentUsageTotals,
  type CodingAgentUsageTotalsInput,
  type CodingAgentTracePullRequestInput,
  type CodingAgentTracePullRequestLink,
  type CodingAgentTranscript,
  codingAgentTranscriptSchema,
  type ContributeSpanFactsCommandData,
  type CodingAgentReceivedSpan,
  type CodingAgentSessionEventsPage,
  type CodingAgentSessionEventsPageInput,
} from "@langwatch/coding-agent-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { GithubApi, GithubPullRequestNotMappedError } from "@langwatch/github-contract";
import { ValidationError } from "@langwatch/handled-error";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { type SpanDetail, TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";

import {
  type CodingAgentProcessingPipeline,
  EventingCodingAgentProcessingAdapter,
} from "../eventing/coding-agent-processing.pipeline.ts";
import type { CodingAgentRepositories } from "../repositories/coding-agent.repositories.ts";
import {
  gatePullRequestSessionTitles,
  gateSessionListCost,
  gateSessionListTitles,
} from "../rules/coding-agent-gates.rules.ts";
import {
  encodeSessionCursor,
  readSessionCursor,
} from "../rules/coding-agent-session-cursor.rules.ts";
import { liftSpanContribution } from "../rules/coding-agent-span-facts.rules.ts";
import { CodingAgentCallerScopeService } from "../services/coding-agent-caller-scope.service.ts";
import { SystemCodingAgentClockService } from "../services/coding-agent-clock.service.ts";
import { CodingAgentCommandDispatcherService } from "../services/coding-agent-command-dispatcher.service.ts";
import { GovernanceCodingAgentBillingService } from "../services/coding-agent-cost-attribution.service.ts";
import { OtelCodingAgentCostMetricsService } from "../services/coding-agent-cost-metrics.service.ts";
import { CodingAgentProjectionPersistenceService } from "../services/coding-agent-projection-persistence.service.ts";
import { CodingAgentReceivedFactsService } from "../services/coding-agent-received-facts.service.ts";
import { CodingAgentScopeDirectoryService } from "../services/coding-agent-scope-directory.service.ts";
import { CodingAgentScopePermissionsService } from "../services/coding-agent-scope-permissions.service.ts";
import { CodingAgentViewerVisibilityService } from "../services/coding-agent-viewer-visibility.service.ts";
import {
  type CodingAgentSessionService,
  CodingAgentFeatureService,
} from "../services/coding-agent.service.ts";
import { ModelCatalogCostEstimatorService } from "../services/model-catalog-cost-estimator.service.ts";
import type {
  CodingAgentScopeCaller,
  CodingAgentViewerVisibilityReader,
} from "./coding-agent.members.ts";

/**
 * The caller's permission cut over an organization: which projects they may
 * read, which of those they may also price, and how each is named. Derived
 * from the service's own input rather than restated, so the two cannot drift.
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
export interface CodingAgentScopeMembers {
  /**
   * The organization a project belongs to, or undefined for an orphan project.
   * Derived here rather than taken from the client, so a caller cannot ask
   * about another tenant's pull requests by naming its id.
   */
  findOrganizationForProject(projectId: string): Promise<string | undefined>;
  /**
   * The organization's projects split by what one caller may do with each.
   * Enumerated from the organization rather than the request, so a caller
   * cannot count a project by naming one it may not read.
   */
  resolveCallerProjectScope(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
  }): Promise<CodingAgentCallerScope>;
}

/** What the process composes this feature's application from: nothing, every need is a peer. */
export type CodingAgentInfrastructure = Readonly<Record<never, never>>;

type CodingAgentDependencies = {
  projects: typeof ProjectApi;
  github: typeof GithubApi;
  traces: typeof TraceApi;
  retention: typeof DataRetentionApi;
  authz: typeof AuthzApi;
  organizations: typeof OrganizationApi;
  users: typeof UserApi;
  auditLog: typeof AuditLogApi;
  governance: typeof GovernanceRestApi;
};
type CodingAgentSetup = FeatureSetup<
  CodingAgentDependencies,
  CodingAgentInfrastructure,
  undefined,
  CodingAgentRepositories
>;

export class CodingAgentApp implements CodingAgentApi {
  static readonly contract = CodingAgentApiToken;
  static readonly dependencies: CodingAgentDependencies = {
    projects: ProjectApi,
    github: GithubApi,
    /** Claude-call classification the session fold prices cache writes by. */
    traces: TraceApi,
    /** Owns the platform default retention a session's rows are stamped with, read lazily. */
    retention: DataRetentionApi,
    /** Decides both project cuts of a cross-project read in one batched ask. */
    authz: AuthzApi,
    /** Names each personal workspace by its owner. */
    organizations: OrganizationApi,
    users: UserApi,
    /** Where a read that names people is written down. */
    auditLog: AuditLogApi,
    /** Decides which coding-assistant sources a bundled plan covers. */
    governance: GovernanceRestApi,
  };

  static create({ dependencies, repositories }: CodingAgentSetup): CodingAgentApp {
    const service = CodingAgentFeatureService.create({
      sessions: repositories.sessions,
      traceSessions: repositories.traceSessions,
      metricSeries: repositories.metricSeries,
      sessionEvents: repositories.sessionEvents,
      github: dependencies.github,
      projects: dependencies.projects,
      billing: GovernanceCodingAgentBillingService.create({ governance: dependencies.governance }),
      clock: SystemCodingAgentClockService.create(),
    });
    const scopeService = CodingAgentCallerScopeService.create({
      directory: CodingAgentScopeDirectoryService.create({
        projects: dependencies.projects,
        organizations: dependencies.organizations,
        users: dependencies.users,
      }),
      permissions: CodingAgentScopePermissionsService.create({ authz: dependencies.authz }),
    });
    const scope: CodingAgentScopeMembers = {
      findOrganizationForProject: async (projectId: string) => {
        try {
          return await dependencies.projects.getOrganizationId(projectId);
        } catch {
          return undefined;
        }
      },
      resolveCallerProjectScope: (input) => scopeService.resolve(input),
    };
    const commands = CodingAgentCommandDispatcherService.create();
    const processing = EventingCodingAgentProcessingAdapter.create({
      traceCanonicalisation: dependencies.traces,
      modelProviders: ModelCatalogCostEstimatorService.create(),
      costMetrics: OtelCodingAgentCostMetricsService.create(),
      projections: CodingAgentProjectionPersistenceService.create(repositories),
      projects: dependencies.projects,
      clock: SystemCodingAgentClockService.create(),
      defaultRetentionDays: () => dependencies.retention.getPlatformDefaultRetentionDays(),
      retention: {
        resolve: (tenantId) =>
          dependencies.retention.getResolvedForProject({ projectId: tenantId }),
      },
      sessionContextMemo: repositories.sessionContextMemo,
      sessionFoldCache: repositories.sessionFoldCache,
      github: dependencies.github,
      receivedFacts: CodingAgentReceivedFactsService.create({
        traces: dependencies.traces,
        commands,
      }),
    }).build();
    return new CodingAgentApp({
      codingAgents: service,
      github: dependencies.github,
      traces: dependencies.traces,
      scope,
      visibility: CodingAgentViewerVisibilityService.create({ traces: dependencies.traces }),
      auditLog: dependencies.auditLog,
      processing,
      commands,
    });
  }

  readonly #codingAgents: CodingAgentSessionService;
  readonly #github: GithubApi;
  readonly #traces: TraceApi;
  readonly #scope: CodingAgentScopeMembers;
  readonly #visibility: CodingAgentViewerVisibilityReader;
  readonly #auditLog: Pick<AuditLogApi, "record">;
  readonly #processing: CodingAgentProcessingPipeline;
  readonly #commands: CodingAgentCommandDispatcherService;

  private constructor({
    codingAgents,
    github,
    traces,
    scope,
    visibility,
    auditLog,
    processing,
    commands,
  }: {
    codingAgents: CodingAgentSessionService;
    github: GithubApi;
    traces: TraceApi;
    scope: CodingAgentScopeMembers;
    visibility: CodingAgentViewerVisibilityReader;
    auditLog: Pick<AuditLogApi, "record">;
    processing: CodingAgentProcessingPipeline;
    commands: CodingAgentCommandDispatcherService;
  }) {
    this.#codingAgents = codingAgents;
    this.#github = github;
    this.#traces = traces;
    this.#scope = scope;
    this.#visibility = visibility;
    this.#auditLog = auditLog;
    this.#processing = processing;
    this.#commands = commands;
  }

  /** The session pipeline this module registers, built once by {@link create}. */
  eventingPipeline(): CodingAgentProcessingPipeline {
    return this.#processing;
  }

  /** Binds the registered pipeline's own senders. */
  connectCommands(commands: EventingCommands<CodingAgentProcessingPipeline>): void {
    this.#commands.connect(commands);
  }

  contributeSpanFacts(data: ContributeSpanFactsCommandData): Promise<void> {
    return this.#commands.contributeSpanFacts(data);
  }

  contributeReceivedSpan(input: CodingAgentReceivedSpan): Promise<void> {
    return this.contributeSpanFacts(liftSpanContribution(input));
  }

  /** Pure derivation, no session store read: which log fields an event name captures. */
  logContentKeys(eventName: string): readonly LogContentKey[] {
    return logContentKeys(eventName);
  }

  /** Pure derivation, no session store read: which attribute keys an event name captures. */
  contentAttrKeys(eventName: string): readonly string[] {
    return contentAttrKeys(eventName);
  }

  /** Pure derivation, no session store read: whether a span is coding-agent noise. */
  shouldFilterSpan(input: CodingAgentSpanFilterInput): boolean {
    return shouldFilterCodingAgentSpan(input);
  }

  /** Pure derivation, no session store read: folds spans and logs into a transcript. */
  buildTranscript(input: {
    spans: SpanDetail[];
    logs: TranscriptLogRecord[];
  }): CodingAgentTranscript {
    return buildCodingAgentTranscript(input);
  }

  findBySessionId(input: CodingAgentSessionLookupInput): Promise<CodingAgentSession | null> {
    return this.#codingAgents.findBySessionId(input);
  }

  findSessionForTrace(input: {
    projectId: string;
    traceId: string;
  }): Promise<CodingAgentSession | null> {
    return this.#codingAgents.findSessionForTrace(input);
  }

  /** Port of main's `traces.codingAgentTranscript`: trace redacts for the viewer, then builds. */
  async readTranscriptForViewer(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number | undefined;
    viewerUserId: string;
  }): Promise<CodingAgentTranscript> {
    return codingAgentTranscriptSchema.parse(await this.#traces.readCodingAgentTranscript(input));
  }

  linkTraceSessionsToPullRequests(
    input: CodingAgentTracePullRequestInput,
  ): Promise<CodingAgentTracePullRequestLink[]> {
    return this.#codingAgents.linkTraceSessionsToPullRequests(input);
  }

  /** One session's event sequence, in time order, keyset-paginated. */
  getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }> {
    return this.#codingAgents.getSessionEvents(input);
  }

  /** The REST door's events page: both window bounds or neither, and an opaque cursor both ways. */
  async readSessionEventsPage(
    input: CodingAgentSessionEventsPageInput,
  ): Promise<CodingAgentSessionEventsPage> {
    // Half a window would silently widen the read past what the caller asked for.
    if ((input.from === undefined) !== (input.to === undefined)) {
      throw new ValidationError("from and to must be supplied together");
    }
    const { events, nextCursor } = await this.getSessionEvents({
      projectId: input.projectId,
      sessionId: input.sessionId,
      kinds: input.kinds,
      occurredAt:
        input.from !== undefined && input.to !== undefined
          ? { fromMs: input.from, toMs: input.to }
          : undefined,
      cursor: input.cursor !== undefined ? decodableCursor(input.cursor) : undefined,
      limit: input.limit,
    });
    return { events, nextCursor: nextCursor ? encodeSessionCursor(nextCursor) : null };
  }

  /** The project's "at a glance" totals over a window. */
  getUsageTotals(input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals> {
    return this.#codingAgents.getUsageTotals(input);
  }

  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<CodingAgentUsageCount> {
    return this.#codingAgents.countUsage(input);
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
    await this.#auditLog.record({
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
   * session's title resolves against the project it ran in, since a reader
   * trusted with one project's conversations may not be trusted with another's.
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
    const organizationId = await this.#scope.findOrganizationForProject(pullRequest.projectId);
    if (organizationId) return organizationId;
    throw new GithubPullRequestNotMappedError({
      repositoryFullName: pullRequest.repositoryFullName,
      prNumber: pullRequest.prNumber,
    });
  }
}

/** The cursor a caller sent back; one this door never wrote is a validation error. */
function decodableCursor(raw: string): CodingAgentSessionCursor {
  const read = readSessionCursor(raw);
  if (!read.decodable) throw new ValidationError("cursor is not decodable");
  return read.cursor;
}

/** Nothing readable, nothing priceable, nobody named. */
function emptyCallerScope(): CodingAgentCallerScope {
  return { permittedProjectIds: [], costProjectIds: [], projects: {} };
}
