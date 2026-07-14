/**
 * @vitest-environment node
 *
 * Pins the installation service's business rules: recording an install from the
 * GitHub-fetched metadata, the webhook lifecycle (delete / suspend / repo
 * refresh), and per-turn token minting + repo resolution (explicit repo scopes
 * to one, no repo scopes to the whole installation, missing repo → null).
 */
import { describe, expect, it, vi } from "vitest";

import { LangyGithubInstallationsService } from "../langy-github-installations.service";
import { computeRepoScopeKey } from "../langyGithubAppToken";
import type {
  LangyGithubInstallationRow,
  LangyGithubInstallationsRepository,
  UpsertLangyGithubInstallationInput,
} from "../repositories/langy-github-installations.repository";

function makeRepo(
  rows: LangyGithubInstallationRow[] = [],
): LangyGithubInstallationsRepository & {
  upsert: ReturnType<typeof vi.fn>;
  deleteByInstallationId: ReturnType<typeof vi.fn>;
  setSuspended: ReturnType<typeof vi.fn>;
  setRepositories: ReturnType<typeof vi.fn>;
} {
  const byId = new Map(rows.map((r) => [r.installationId, r]));
  return {
    findAllForOrganization: vi.fn(async (orgId: string) =>
      [...byId.values()].filter((r) => r.organizationId === orgId),
    ),
    findByInstallationId: vi.fn(
      async (id: string) => byId.get(id) ?? null,
    ),
    upsert: vi.fn(async (_i: UpsertLangyGithubInstallationInput) => {}),
    setRepositories: vi.fn(async () => {}),
    setSuspended: vi.fn(async () => {}),
    deleteByInstallationId: vi.fn(async () => 1),
    isOrganizationMember: vi.fn(async () => true),
  };
}

function row(
  over: Partial<LangyGithubInstallationRow> = {},
): LangyGithubInstallationRow {
  return {
    installationId: "inst-1",
    organizationId: "org-1",
    accountLogin: "acme",
    accountType: "Organization",
    accountId: "9000",
    repositorySelection: "all",
    repositories: null,
    suspendedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

// Minimal app-token stub. Only the methods the service calls are provided.
function makeAppTokens(
  over: Partial<{
    configured: boolean;
    getInstallation: ReturnType<typeof vi.fn>;
    mintInstallationToken: ReturnType<typeof vi.fn>;
    listInstallationRepositories: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    get configured() {
      return over.configured ?? true;
    },
    getInstallation:
      over.getInstallation ??
      vi.fn(async () => ({
        installationId: "inst-1",
        accountLogin: "acme",
        accountType: "Organization",
        accountId: "9000",
        repositorySelection: "all",
      })),
    mintInstallationToken:
      over.mintInstallationToken ??
      vi.fn(async () => ({ token: "ghs_tok", expiresAt: "" })),
    listInstallationRepositories:
      over.listInstallationRepositories ??
      vi.fn(async () => [{ id: "77", fullName: "acme/service-x" }]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("recordInstallation", () => {
  it("maps GitHub's installation metadata onto the upsert", async () => {
    const repo = makeRepo();
    const svc = new LangyGithubInstallationsService(repo, makeAppTokens());
    const result = await svc.recordInstallation({
      installationId: "inst-1",
      organizationId: "org-1",
    });
    expect(result.accountLogin).toBe("acme");
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        organizationId: "org-1",
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "all",
      }),
    );
  });
});

describe("handleWebhookEvent", () => {
  describe("when the installation is deleted", () => {
    it("removes the row", async () => {
      const repo = makeRepo([row()]);
      const svc = new LangyGithubInstallationsService(repo, makeAppTokens());
      await svc.handleWebhookEvent({ action: "deleted", installationId: "inst-1" });
      expect(repo.deleteByInstallationId).toHaveBeenCalledWith("inst-1");
    });
  });

  describe("when the installation is suspended", () => {
    it("flags it suspended", async () => {
      const repo = makeRepo([row()]);
      const svc = new LangyGithubInstallationsService(repo, makeAppTokens());
      await svc.handleWebhookEvent({ action: "suspend", installationId: "inst-1" });
      expect(repo.setSuspended).toHaveBeenCalledWith({
        installationId: "inst-1",
        suspended: true,
      });
    });
  });

  describe("when repositories change for an unknown installation", () => {
    it("does nothing (setup callback owns first-time mapping)", async () => {
      const repo = makeRepo();
      const svc = new LangyGithubInstallationsService(repo, makeAppTokens());
      await svc.handleWebhookEvent({ action: "added", installationId: "ghost" });
      expect(repo.setRepositories).not.toHaveBeenCalled();
    });
  });
});

describe("mintTurnToken", () => {
  describe("when the App is not configured", () => {
    it("returns null", async () => {
      const repo = makeRepo([row()]);
      const svc = new LangyGithubInstallationsService(
        repo,
        makeAppTokens({ configured: false }),
      );
      expect(
        await svc.mintTurnToken({ organizationId: "org-1" }),
      ).toBeNull();
    });
  });

  describe("when the org has no installation", () => {
    it("returns null", async () => {
      const repo = makeRepo([]);
      const svc = new LangyGithubInstallationsService(repo, makeAppTokens());
      expect(
        await svc.mintTurnToken({ organizationId: "org-1" }),
      ).toBeNull();
    });
  });

  describe("when no explicit repo is given", () => {
    it("mints a full-installation-scoped token", async () => {
      const repo = makeRepo([row()]);
      const mint = vi.fn(async () => ({ token: "ghs_all", expiresAt: "" }));
      const svc = new LangyGithubInstallationsService(
        repo,
        makeAppTokens({ mintInstallationToken: mint }),
      );
      const result = await svc.mintTurnToken({ organizationId: "org-1" });
      expect(result?.token).toBe("ghs_all");
      expect(result?.repoScopeKey).toBe(computeRepoScopeKey({}));
      // No repository_ids ⇒ full installation scope.
      expect(mint).toHaveBeenCalledWith({ installationId: "inst-1" });
    });
  });

  describe("when an explicit repo is reachable", () => {
    it("scopes the token to only that repository", async () => {
      const repo = makeRepo([
        row({
          repositorySelection: "selected",
          repositories: [{ id: "77", fullName: "acme/service-x" }],
        }),
      ]);
      const mint = vi.fn(async () => ({ token: "ghs_one", expiresAt: "" }));
      const svc = new LangyGithubInstallationsService(
        repo,
        makeAppTokens({ mintInstallationToken: mint }),
      );
      const result = await svc.mintTurnToken({
        organizationId: "org-1",
        repositoryFullName: "acme/service-x",
      });
      expect(result?.token).toBe("ghs_one");
      expect(result?.repoScopeKey).toBe(
        computeRepoScopeKey({ repositoryIds: ["77"] }),
      );
      expect(mint).toHaveBeenCalledWith({
        installationId: "inst-1",
        repositoryIds: ["77"],
      });
    });
  });

  describe("when an explicit repo is not reachable by any installation", () => {
    it("returns null (installation scoping bounds it)", async () => {
      const repo = makeRepo([
        row({
          repositorySelection: "selected",
          repositories: [{ id: "77", fullName: "acme/service-x" }],
        }),
      ]);
      const svc = new LangyGithubInstallationsService(repo, makeAppTokens());
      const result = await svc.mintTurnToken({
        organizationId: "org-1",
        repositoryFullName: "acme/other-repo",
      });
      expect(result).toBeNull();
    });
  });

  describe("when the only installation is suspended", () => {
    it("returns null", async () => {
      const repo = makeRepo([row({ suspendedAt: new Date() })]);
      const svc = new LangyGithubInstallationsService(repo, makeAppTokens());
      expect(
        await svc.mintTurnToken({ organizationId: "org-1" }),
      ).toBeNull();
    });
  });
});
