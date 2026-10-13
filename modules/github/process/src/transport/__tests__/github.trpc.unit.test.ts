import { createTrpcRuntime } from "@langwatch/api/trpc";
import { GithubNotConnectedError, type GithubApi } from "@langwatch/github-contract";
/**
 * @vitest-environment node
 * The `github.*` procedures over the real tRPC runtime.
 * @see modules/integration/specs/github-connection.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { githubTrpcTransport, type GithubConnectionApi } from "../github.trpc.ts";
import { githubTrpcTestMembers, type GithubTrpcTestContext } from "./github.trpc.harness.ts";

function mount({
  isOrganizationMember = true,
  github = {},
  getProjectPullRequestLiveStatuses = async () => ({ statuses: [] }),
  permits = () => true,
}: {
  isOrganizationMember?: boolean;
  github?: Partial<GithubApi>;
  getProjectPullRequestLiveStatuses?: GithubConnectionApi["getProjectPullRequestLiveStatuses"];
  permits?: (permission: string) => boolean;
} = {}) {
  const recordAudit = vi.fn<() => Promise<void>>(async () => {});
  const service = createApiFixture<GithubApi>({
    isOrganizationMember: async () => isOrganizationMember,
    ...github,
  });
  const connection = createApiFixture<GithubConnectionApi>({
    github: () => service,
    recordAudit,
    getProjectPullRequestLiveStatuses,
  });
  const { members, asked } = githubTrpcTestMembers(permits);
  const trpc = initTRPC.context<GithubTrpcTestContext>().create();
  const router = createTrpcRuntime<GithubTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members,
  }).mount(githubTrpcTransport, () => connection);

  return { router, asked, recordAudit, caller: router.createCaller({ actor: { id: "user-1" } }) };
}

describe("the github tRPC namespace", () => {
  describe("given the mounted router", () => {
    /** @scenario "compatibility transports keep their public paths" */
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).toSorted()).toEqual([
        "disconnect",
        "getConnectionStatus",
        "listRepos",
        "pullRequestLiveStatus",
      ]);
    });

    it("reads with a query and changes with a mutation", () => {
      const { router } = mount();
      const kinds = Object.fromEntries(
        Object.entries(router._def.procedures).map(([name, procedure]) => [
          name,
          (procedure as { _def: { type: string } })._def.type,
        ]),
      );

      expect(kinds).toEqual({
        getConnectionStatus: "query",
        listRepos: "query",
        pullRequestLiveStatus: "query",
        disconnect: "mutation",
      });
    });

    /**
     * Which permission each procedure DEMANDS, not just that one is demanded.
     * Reading the connection asks `organization:view`, which every member
     * holds; listing repositories and disconnecting ask `organization:manage`,
     * because an installation grants repository access to the whole
     * organization; the pull-request status asks `traces:view`.
     */
    /** @scenario "Changing the organization's GitHub connection is admin-only" */
    it("demands the permission each procedure is declared with", async () => {
      const { caller, asked } = mount({
        github: {
          getConnectionStatus: async () => ({
            configured: true,
            connected: false,
            installations: [],
            installUrl: null,
          }),
          listRepositoriesForOrganization: async () => [],
          disconnect: async () => ({ uninstallUrl: "https://github.com/x" }),
        },
      });

      await caller.getConnectionStatus({ organizationId: "org-1" });
      await caller.listRepos({ organizationId: "org-1" });
      await caller.pullRequestLiveStatus({ projectId: "project-1", refs: [] });
      await caller.disconnect({ organizationId: "org-1", installationId: "555" });

      expect([...asked].toSorted()).toEqual([
        "organization:manage",
        "organization:manage",
        "organization:view",
        "traces:view",
      ]);
    });
  });

  describe("when a permitted caller is not a member of the organization", () => {
    it("refuses before any connection state is read", async () => {
      const getConnectionStatus = vi.fn<() => never>();
      const { caller } = mount({
        isOrganizationMember: false,
        github: { getConnectionStatus },
      });

      await expect(
        caller.getConnectionStatus({ organizationId: "victim-org" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getConnectionStatus).not.toHaveBeenCalled();
    });

    it("refuses to list repositories, without reading any", async () => {
      const listRepositoriesForOrganization = vi.fn<() => never>();
      const { caller } = mount({
        isOrganizationMember: false,
        github: { listRepositoriesForOrganization },
      });

      await expect(caller.listRepos({ organizationId: "victim-org" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(listRepositoriesForOrganization).not.toHaveBeenCalled();
    });
  });

  describe("when a caller may read the organization but not manage it", () => {
    it("refuses the disconnect and still answers the read", async () => {
      const { caller } = mount({
        permits: (permission) => permission === "organization:view",
        github: {
          getConnectionStatus: async () => ({
            configured: true,
            connected: false,
            installations: [],
            installUrl: null,
          }),
        },
      });

      await expect(caller.getConnectionStatus({ organizationId: "org-1" })).resolves.toMatchObject({
        connected: false,
      });
      await expect(
        caller.disconnect({ organizationId: "org-1", installationId: "555" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("when a member disconnects an installation", () => {
    /** @scenario "compatibility transports keep their public paths" */
    it("records the disconnect against the organization and hands back the link", async () => {
      const { caller, recordAudit } = mount({
        github: { disconnect: async () => ({ uninstallUrl: "https://github.com/x" }) },
      });

      const result = await caller.disconnect({ organizationId: "org-1", installationId: "555" });

      expect(result).toEqual({ uninstallUrl: "https://github.com/x" });
      expect(recordAudit).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
        action: "github.connection.disconnect",
        args: { installationId: "555" },
      });
    });

    it("leaves no audit record when the organization has no such installation", async () => {
      const { caller, recordAudit } = mount({
        github: {
          disconnect: async () => {
            throw new GithubNotConnectedError("org-1");
          },
        },
      });

      await expect(
        caller.disconnect({ organizationId: "org-1", installationId: "555" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(recordAudit).not.toHaveBeenCalled();
    });
  });

  describe("when a project's pull-request statuses are asked for", () => {
    it("hands the project and refs to one operation and answers with its statuses", async () => {
      const getProjectPullRequestLiveStatuses = vi.fn<
        GithubConnectionApi["getProjectPullRequestLiveStatuses"]
      >(async () => ({ statuses: [] }));
      const { caller } = mount({ getProjectPullRequestLiveStatuses });

      const result = await caller.pullRequestLiveStatus({ projectId: "project-1", refs: [] });

      expect(result).toEqual({ statuses: [] });
      expect(getProjectPullRequestLiveStatuses).toHaveBeenCalledWith({
        projectId: "project-1",
        refs: [],
      });
    });
  });
});
