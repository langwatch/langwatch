/**
 * The install follow-up through the real chain: `/setup`, the coding-agent
 * application, the backfill, and the branch demand that marks a project.
 * @see specs/coding-agent/project-menu-links.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  CodingAgentApp,
  CodingAgentClockPort,
  CodingAgentPullRequestMappingBackfillService,
} from "@langwatch/coding-agent-server";
import type { CodingAgentSessionReads } from "@langwatch/coding-agent-server";
import {
  CodingAgentService,
  type CodingAgentPullRequestMappingBackfillInput,
  type CodingAgentSession,
} from "@langwatch/coding-agent-contract";
import { codingAgentSessionFixture } from "@langwatch/coding-agent-contract/testing";
import { GithubService, type GithubAppConfig } from "@langwatch/github-contract";
import {
  createGithubRestApp,
  GithubBranchDemandService,
  GithubHostPort,
  GithubProjectActivityPort,
  type BranchMappingRequest,
} from "@langwatch/github-server";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { composeApiGithubRest } from "../github-rest.mount.ts";

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "project_1";
const USER_ID = "user_1";

describe("given a project whose recorded sessions name their branches", () => {
  describe("when the organization completes the GitHub installation flow", () => {
    /** @scenario "Connecting GitHub records the backfilled pull requests on their projects" */
    it("records that a pull request was seen on the project whose sessions named the branch", async () => {
      const world = installWorld({
        sessions: [
          codingAgentSessionFixture({
            tenantId: PROJECT_ID,
            sessionId: "session-backfilled",
            repositoryHost: "github.com",
            repositoryOwner: "acme",
            repositoryName: "widgets",
            gitBranch: "feat/backfill-attributed",
          }),
        ],
        pullRequestsFound: 1,
      });

      const response = await world.api.fetch(
        `/api/github/setup?installation_id=42&state=${signedState()}`,
      );

      expect(response.status).toBe(302);
      // The follow-up is fire-and-forget at the door, so the redirect can
      // land before it settles.
      await vi.waitFor(() => {
        expect(world.projectActivity.map((entry) => entry.projectId)).toContain(PROJECT_ID);
      });
      expect(world.mappingRequests).toEqual([
        {
          tenantId: PROJECT_ID,
          repositoryHost: "github.com",
          repositoryOwner: "acme",
          repositoryName: "widgets",
          headBranch: "feat/backfill-attributed",
        },
      ]);
    });

    it("records nothing on the project when the backfilled branch has no pull request", async () => {
      const world = installWorld({
        sessions: [
          codingAgentSessionFixture({
            tenantId: PROJECT_ID,
            sessionId: "session-unmapped",
            repositoryHost: "github.com",
            repositoryOwner: "acme",
            repositoryName: "widgets",
            gitBranch: "feat/no-pull-request",
          }),
        ],
        pullRequestsFound: 0,
      });

      const response = await world.api.fetch(
        `/api/github/setup?installation_id=42&state=${signedState()}`,
      );

      expect(response.status).toBe(302);
      await vi.waitFor(() => {
        expect(world.mappingRequests).toHaveLength(1);
      });
      expect(world.projectActivity).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------

function signedState(): string {
  return encodeURIComponent(
    JSON.stringify({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      mode: "redirect",
      returnTo: "/settings/integrations#github",
      issuedAt: Date.now(),
      nonce: "n",
      nonceRegistered: false,
    }),
  );
}

function installWorld(options: {
  sessions: readonly CodingAgentSession[];
  pullRequestsFound: number;
}) {
  const projectActivity: { projectId: string; at: Date }[] = [];
  const mappingRequests: BranchMappingRequest[] = [];

  const activity = new (class extends GithubProjectActivityPort {
    getOrganizationId(): Promise<string> {
      return Promise.resolve(ORGANIZATION_ID);
    }

    touchCodingAgentPullRequestSeen(input: { projectId: string; at: Date }): Promise<void> {
      projectActivity.push(input);
      return Promise.resolve();
    }
  })();

  // The real demand service, over a mapping that finds what the case says it
  // finds: whether a project is marked is its decision, not the test's.
  const demand = GithubBranchDemandService.create({
    mapping: {
      bringRecheckForward: () => Promise.resolve(),
      map: () => Promise.resolve(options.pullRequestsFound),
    },
    project: activity,
    host: new TestGithubHost(),
  });

  const github = new TestGithubService(async (request) => {
    mappingRequests.push(request);
    await demand.request(request);
  });

  const backfill = CodingAgentPullRequestMappingBackfillService.create({
    sessionReads: sessionReadsOf(options.sessions),
    github,
    projects: {
      listByOrganization: () => Promise.resolve({ data: [{ id: PROJECT_ID }] }),
    },
    clock: new TestClock(),
  });

  const codingAgents = CodingAgentApp.create({
    codingAgents: new BackfillOnlyCodingAgents(backfill),
    github,
    scope: {
      tryResolveOrganizationForProject: () => Promise.resolve(ORGANIZATION_ID),
      resolveCallerProjectScope: () =>
        Promise.reject(new Error("This world reads no cross-project scope.")),
    },
  });

  const ports = composeApiGithubRest({
    github,
    session: () => Promise.resolve({ id: USER_ID }),
    authz: { hasPermission: () => Promise.resolve(true) } as never,
    audit: undefined,
    codingAgents,
  });
  if (!ports) throw new Error("The GitHub family composed nothing for this world.");

  const hono = new Hono().route(
    "/",
    createGithubRestApp({ security: passThroughSecurity(), ports }),
  );

  return {
    projectActivity,
    mappingRequests,
    api: {
      fetch: (path: string) => hono.fetch(new Request(`http://api.test${path}`)),
    },
  };
}

function sessionReadsOf(sessions: readonly CodingAgentSession[]): CodingAgentSessionReads {
  return {
    listRecent: ({ projectId }) =>
      Promise.resolve(sessions.filter((session) => session.tenantId === projectId)),
  };
}

class TestClock extends CodingAgentClockPort {
  nowMs(): number {
    return Date.now();
  }
}

class TestGithubHost extends GithubHostPort {
  getHost(): string {
    return "github.com";
  }

  getApiBase(): string {
    return "https://api.github.com";
  }

  getWebBase(): string {
    return "https://github.com";
  }

  getAppInstallUrl(): string {
    return "https://github.test/install";
  }

  isMappable(repositoryHost: string): boolean {
    return repositoryHost === "github.com";
  }

  normalize(repositoryHost: string): string {
    return repositoryHost.toLowerCase();
  }
}

/** The coding-agent contract holding only the install follow-up. */
class BackfillOnlyCodingAgents extends CodingAgentService {
  constructor(private readonly backfill: CodingAgentPullRequestMappingBackfillService) {
    super();
  }

  backfillPullRequestMappings(input: CodingAgentPullRequestMappingBackfillInput): Promise<void> {
    return this.backfill.backfill(input);
  }

  private unread(): Promise<never> {
    return Promise.reject(new Error("This world reads only the install follow-up."));
  }

  getSessionEvents(): Promise<never> {
    return this.unread();
  }

  tryGetBySessionId(): Promise<never> {
    return this.unread();
  }

  tryGetSessionForTrace(): Promise<never> {
    return this.unread();
  }

  listRecent(): Promise<never> {
    return this.unread();
  }

  getUsageTotals(): Promise<never> {
    return this.unread();
  }

  listForProject(): Promise<never> {
    return this.unread();
  }

  linkTraceSessionsToPullRequests(): Promise<never> {
    return this.unread();
  }

  getPullRequestUsage(): Promise<never> {
    return this.unread();
  }

  getPullRequestDetail(): Promise<never> {
    return this.unread();
  }

  getForPersonalProject(): Promise<never> {
    return this.unread();
  }
}

/**
 * The GitHub App as this world stands it in: the install flow's own seam, plus
 * the branch mapping the backfill drives.
 */
class TestGithubService extends GithubService {
  readonly configured = true;

  constructor(private readonly onBranchMapping: (request: BranchMappingRequest) => Promise<void>) {
    super();
  }

  getAppConfig(): GithubAppConfig {
    return { configured: true, appSlug: "test-app", webhookSecret: "webhook-secret" };
  }

  getWebBase(): string {
    return "https://github.com";
  }

  normalizeRepositoryHost(repositoryHost: string): string {
    return repositoryHost.toLowerCase();
  }

  canMapRepositoryHost(repositoryHost: string): boolean {
    return repositoryHost === "github.com";
  }

  getAppInstallUrl(): string {
    return "https://github.test/install";
  }

  getInstallStateTtlMs(): number {
    return 600_000;
  }

  registerInstallNonce(): Promise<boolean> {
    return Promise.resolve(false);
  }

  tryConsumeInstallNonce(): Promise<boolean | null> {
    return Promise.resolve(true);
  }

  signInstallState(payload: unknown): string {
    return JSON.stringify(payload);
  }

  tryVerifyInstallState(token: string | null): never {
    return (token ? JSON.parse(token) : null) as never;
  }

  popupResponseHtml(): string {
    return "<html>ok</html>";
  }

  popupErrorHtml(): string {
    return "<html>error</html>";
  }

  tryParsePullRequestEvent(): null {
    return null;
  }

  isOrganizationMember(): Promise<boolean> {
    return Promise.resolve(true);
  }

  recordInstallation(): Promise<{ accountLogin: string }> {
    return Promise.resolve({ accountLogin: "acme" });
  }

  requestBranchMapping(input: BranchMappingRequest): Promise<void> {
    return this.onBranchMapping(input);
  }

  private unread(): Promise<never> {
    return Promise.reject(new Error("This world reads only the install flow and branch mapping."));
  }

  getAllForOrganization(): Promise<never> {
    return this.unread();
  }

  tryGetByInstallationId(): Promise<never> {
    return this.unread();
  }

  getConnectionStatus(): Promise<never> {
    return this.unread();
  }

  disconnect(): Promise<never> {
    return this.unread();
  }

  handleWebhookEvent(): Promise<never> {
    return this.unread();
  }

  listRepositoriesForOrganization(): Promise<never> {
    return this.unread();
  }

  tryMintTurnToken(): Promise<never> {
    return this.unread();
  }

  coversRepository(): Promise<never> {
    return this.unread();
  }

  getLivePullRequestStatuses(): Promise<never> {
    return this.unread();
  }

  applyPullRequestEvent(): Promise<never> {
    return this.unread();
  }

  findForBranches(): Promise<never> {
    return this.unread();
  }

  findAllByBranches(): Promise<never> {
    return this.unread();
  }

  tryFindByNumber(): Promise<never> {
    return this.unread();
  }

  recheckDueBranches(): Promise<never> {
    return this.unread();
  }

  pruneStaleBranchLinkage(): Promise<never> {
    return this.unread();
  }
}

/** A failure here must be legible rather than swallowed into a generic 500. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("This family resolves its own credential.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
