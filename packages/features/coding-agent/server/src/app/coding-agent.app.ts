/**
 * The coding-agent feature's application: what both of its doors call.
 *
 * The session reads answer over two transports — the process's tRPC root for
 * the Sessions screen and the /me page, and a project-scoped REST family for
 * whatever an organization builds on top. Before this, each door declared its
 * own bag: the tRPC door `Readonly<{ codingAgents; github }>` plus three
 * ports, the REST family a `CodingAgentRestServices` with the SAME
 * organization lookup under a different name (`resolveOrganizationId` against
 * `tryResolveOrganizationForProject`) and its own `CodingAgentCallerScope`
 * derived from a different contract type than the tRPC one — two names for one
 * shape, agreeing only because nobody had changed either.
 *
 * What lives here as a method is what a door would otherwise have to know:
 *
 *   - resolving the organization behind a project and refusing when there is
 *     none, which is the tenancy boundary on every cross-project read;
 *   - the caller's permission cut over that organization, enumerated from the
 *     organization rather than taken from the request;
 *   - whether GitHub is connected and where to send someone who wants it to
 *     be, which the /me page renders and which is not a transport's fact.
 *
 * A caller arrives as an argument, never read from a session or a request.
 */
import type {
  CodingAgentPersonalPullRequestUsage,
  CodingAgentPersonalPullRequestUsageInput,
  CodingAgentPullRequestDetail,
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
import {
  GithubPullRequestNotMappedError,
  type GithubService,
} from "@langwatch/github-contract";

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
  tryResolveOrganizationForProject(projectId: string): Promise<string | undefined>;
  /**
   * The organization's projects split by what one caller may do with each.
   *
   * Enumerated from the organization rather than taken from the request: a
   * caller that could name the projects to count could count one it may not
   * read.
   */
  resolveCallerProjectScope(input: {
    userId: string;
    organizationId: string;
  }): Promise<CodingAgentCallerScope>;
}

/** What the process composes this feature's application from. */
export interface CodingAgentAppDependencies {
  codingAgents: CodingAgentService;
  github: GithubService;
  scope: CodingAgentScopePorts;
}

/** Whether GitHub is connected for an organization, and where to connect it. */
export interface CodingAgentGithubConnection {
  connected: boolean;
  installUrl: string | null;
}

export class CodingAgentApp {
  static create(dependencies: CodingAgentAppDependencies): CodingAgentApp {
    return new CodingAgentApp(dependencies);
  }

  private constructor(private readonly dependencies: CodingAgentAppDependencies) {}

  /** One session's event sequence, in time order, keyset-paginated. */
  getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }> {
    return this.dependencies.codingAgents.getSessionEvents(input);
  }

  /** The project's "at a glance" totals over a window. */
  getUsageTotals(input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals> {
    return this.dependencies.codingAgents.getUsageTotals(input);
  }

  /** The project's recent sessions in a window, newest first. */
  listRecent(input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]> {
    return this.dependencies.codingAgents.listRecent(input);
  }

  /** The Sessions screen's display projection for one project. */
  listForProject(
    input: CodingAgentSessionsListInput,
  ): Promise<CodingAgentSessionListRow[]> {
    return this.dependencies.codingAgents.listForProject(input);
  }

  /** The GitHub web origin this instance is bound to. */
  githubWebBase(): string {
    return this.dependencies.github.getWebBase();
  }

  /** The organization a project belongs to, or undefined for an orphan. */
  tryResolveOrganizationForProject(projectId: string): Promise<string | undefined> {
    return this.dependencies.scope.tryResolveOrganizationForProject(projectId);
  }

  /**
   * What one pull request cost, across every project of the organization the
   * caller may read.
   *
   * A project belonging to no organization has no pull request to price, and
   * saying so as "not mapped" is what both doors already answered — a caller
   * cannot tell the difference and does not need to.
   *
   * The organization comes back beside the rollup rather than inside it: the
   * REST door records who read an answer that names people, and the audit row
   * is written against the organization the read actually reached. Answering
   * with it spread into the rollup would put it on the wire.
   */
  async getPullRequestUsage(
    pullRequest: CodingAgentPullRequestRef,
    by: CodingAgentCaller,
  ): Promise<{ usage: CodingAgentPullRequestUsage; organizationId: string }> {
    const organizationId = await this.requireOrganizationFor(pullRequest);
    const scope = await this.dependencies.scope.resolveCallerProjectScope({
      userId: by.id,
      organizationId,
    });
    const usage = await this.dependencies.codingAgents.getPullRequestUsage({
      organizationId,
      repositoryHost: pullRequest.repositoryHost,
      repositoryFullName: pullRequest.repositoryFullName,
      prNumber: pullRequest.prNumber,
      ...scope,
    });
    return { usage, organizationId };
  }

  /** One pull request in full: totals, contributors, models and sessions. */
  async getPullRequestDetail(
    pullRequest: CodingAgentPullRequestRef,
    by: CodingAgentCaller,
  ): Promise<CodingAgentPullRequestDetail> {
    const organizationId = await this.requireOrganizationFor(pullRequest);
    const scope = await this.dependencies.scope.resolveCallerProjectScope({
      userId: by.id,
      organizationId,
    });
    return this.dependencies.codingAgents.getPullRequestDetail({
      organizationId,
      repositoryHost: pullRequest.repositoryHost,
      repositoryFullName: pullRequest.repositoryFullName,
      prNumber: pullRequest.prNumber,
      ...scope,
    });
  }

  /**
   * The personal project's pull requests and unmapped branches, plus whether
   * GitHub is connected — all three at once, because the page needs all three
   * to decide what to render and three round trips would show it in stages.
   *
   * An orphan project answers with an empty permission cut rather than a
   * refusal: there is nothing to read, which is the same answer the rest of
   * this surface gives, and the page still needs the connection block to offer
   * the install.
   */
  async getPersonalProjectPullRequestUsage(
    input: { projectId: string },
    by: CodingAgentCaller,
  ): Promise<CodingAgentPersonalPullRequestUsage & { connection: CodingAgentGithubConnection }> {
    const organizationId = await this.dependencies.scope.tryResolveOrganizationForProject(
      input.projectId,
    );
    const scope = organizationId
      ? await this.dependencies.scope.resolveCallerProjectScope({
          userId: by.id,
          organizationId,
        })
      : emptyCallerScope();

    const usage = await this.dependencies.codingAgents.getForPersonalProject({
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
  async githubConnection(
    organizationId: string | undefined,
  ): Promise<CodingAgentGithubConnection> {
    if (!organizationId) return { connected: false, installUrl: null };

    const installations =
      await this.dependencies.github.getAllForOrganization(organizationId);
    const installable =
      this.dependencies.github.configured &&
      Boolean(this.dependencies.github.getAppConfig().appSlug);
    return {
      connected: installations.length > 0,
      installUrl: installable
        ? `/api/github/install?organizationId=${encodeURIComponent(organizationId)}`
        : null,
    };
  }

  /**
   * The organization behind the project a pull-request read was asked against.
   *
   * An orphan project is answered as "not mapped" rather than "no
   * organization": the caller asked about a pull request, and what they can do
   * about it is the same either way.
   */
  private async requireOrganizationFor(
    pullRequest: CodingAgentPullRequestRef,
  ): Promise<string> {
    const organizationId = await this.dependencies.scope.tryResolveOrganizationForProject(
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
