/**
 * @vitest-environment node
 *
 * The tRPC surface itself: the four procedure names the clients call, the
 * membership gate that runs inside every organization-scoped one, the audit
 * record a disconnect leaves, and the orphan-project short circuit on the
 * pull-request read.
 *
 * The procedure handed in narrows its own context the way an authenticated
 * process procedure does, so this also pins that a process can hand over a
 * procedure it has already composed.
 */
import type { GithubService } from "@langwatch/github-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { GithubTrpcApi } from "../github.api";

type TestContext = {
  app: { github: GithubService };
  actor(): { id: string };
  session: { user: { id: string } } | null;
};

function githubStub(overrides: Partial<GithubService>): GithubService {
  return overrides as GithubService;
}

function harness({
  isOrganizationMember = true,
  tryResolveOrganizationForProject = async () => "org-1" as string | undefined,
  github = {} as Partial<GithubService>,
} = {}) {
  const recordAudit = vi.fn(async () => {});
  const service = githubStub({
    isOrganizationMember: async () => isOrganizationMember,
    ...github,
  });
  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const router = GithubTrpcApi.create(
    trpc,
    { protected: authenticated, policy: () => (procedure) => procedure },
    { tryResolveOrganizationForProject, recordAudit },
  );

  return {
    recordAudit,
    caller: router.createCaller({
      app: { github: service },
      actor: () => ({ id: "user-1" }),
      session: { user: { id: "user-1" } },
    }),
  };
}

describe("GithubTrpcApi", () => {
  describe("given the mounted router", () => {
    /** @scenario "compatibility transports keep their public paths" */
    it("exposes exactly the procedure names the clients call", () => {
      const trpc = initTRPC.context<TestContext>().create();
      const router = GithubTrpcApi.create(
        trpc,
        { protected: trpc.procedure, policy: () => (procedure) => procedure },
        {
          tryResolveOrganizationForProject: async () => undefined,
          recordAudit: async () => {},
        },
      );

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "disconnect",
        "getConnectionStatus",
        "listRepos",
        "pullRequestLiveStatus",
      ]);
    });

    /**
     * Which permission each procedure DEMANDS, not just that one is demanded.
     *
     * Reading the connection asks for `organization:view`, which every member
     * holds, so a surface that needs GitHub can name who to ask; listing
     * repositories and disconnecting ask for `organization:manage`, because an
     * installation grants repository access to the whole organization; and the
     * pull-request status asks for `traces:view`, because what it reveals is
     * what a coding-agent session did rather than anything about the
     * connection. This travelled here from the retired application's own mount
     * when the router moved onto the API process, because the permission is
     * declared by this transport rather than by whoever mounts it.
     */
    it("demands the permission each procedure is declared with", () => {
      const asked: string[] = [];
      const trpc = initTRPC.context<TestContext>().create();
      GithubTrpcApi.create(
        trpc,
        {
          protected: trpc.procedure,
          policy: (permission) => {
            asked.push(permission);
            return (procedure) => procedure;
          },
        },
        {
          tryResolveOrganizationForProject: async () => undefined,
          recordAudit: async () => {},
        },
      );

      expect(asked.sort()).toEqual([
        "organization:manage",
        "organization:manage",
        "organization:view",
        "traces:view",
      ]);
    });
  });

  describe("when a permitted caller is not a member of the organization", () => {
    it("refuses before any connection state is read", async () => {
      const getConnectionStatus = vi.fn();
      const { caller } = harness({
        isOrganizationMember: false,
        github: { getConnectionStatus },
      });

      await expect(
        caller.getConnectionStatus({ organizationId: "victim-org" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getConnectionStatus).not.toHaveBeenCalled();
    });

    it("refuses to list repositories, without reading any", async () => {
      const listRepositoriesForOrganization = vi.fn();
      const { caller } = harness({
        isOrganizationMember: false,
        github: { listRepositoriesForOrganization },
      });

      await expect(caller.listRepos({ organizationId: "victim-org" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(listRepositoriesForOrganization).not.toHaveBeenCalled();
    });
  });

  describe("when a member disconnects an installation", () => {
    /** @scenario "compatibility transports keep their public paths" */
    it("records the disconnect against the organization and hands back the link", async () => {
      const { caller, recordAudit } = harness({
        github: {
          disconnect: async () => ({ uninstallUrl: "https://github.com/x" }),
        },
      });

      const result = await caller.disconnect({
        organizationId: "org-1",
        installationId: "555",
      });

      expect(result).toEqual({ uninstallUrl: "https://github.com/x" });
      expect(recordAudit).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
        action: "github.connection.disconnect",
        args: { installationId: "555" },
      });
    });

    it("leaves no audit record when the organization has no such installation", async () => {
      const { caller, recordAudit } = harness({
        github: {
          disconnect: async () => {
            throw new TRPCError({ code: "NOT_FOUND" });
          },
        },
      });

      await expect(
        caller.disconnect({ organizationId: "org-1", installationId: "555" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(recordAudit).not.toHaveBeenCalled();
    });
  });

  describe("when the project belongs to no organization", () => {
    it("answers with no pull-request statuses rather than reaching GitHub", async () => {
      const getLivePullRequestStatuses = vi.fn();
      const { caller } = harness({
        tryResolveOrganizationForProject: async () => undefined,
        github: { getLivePullRequestStatuses },
      });

      const result = await caller.pullRequestLiveStatus({
        projectId: "project-1",
        refs: [],
      });

      expect(result).toEqual({ statuses: [] });
      expect(getLivePullRequestStatuses).not.toHaveBeenCalled();
    });
  });
});
