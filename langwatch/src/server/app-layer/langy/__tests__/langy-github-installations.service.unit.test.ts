/**
 * @vitest-environment node
 *
 * Pins the installation service's business rules: recording an install from the
 * GitHub-fetched metadata, the webhook lifecycle (delete / suspend / repo
 * refresh), and per-turn token minting + repo resolution (explicit repo scopes
 * to one, no repo scopes to the whole installation, missing repo → null).
 */
import { describe, expect, it, vi } from "vitest";

import {
  LangyGithubInstallationConflictError,
  LangyGithubInstallationsService,
} from "../langy-github-installations.service";
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
  insertOrGetExisting: ReturnType<typeof vi.fn>;
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
    // Mirrors the real unique-index semantics: the read (`byId.get`) and the
    // write (`byId.set`) below have no `await` between them, so this function
    // body runs to completion in one microtask turn — exactly like a DB
    // unique-constraint `INSERT` — which is what makes the race test below a
    // real regression test rather than a coincidence of mock timing.
    insertOrGetExisting: vi.fn(
      async (input: UpsertLangyGithubInstallationInput) => {
        const existing = byId.get(input.installationId);
        if (existing) return { wasInserted: false, row: existing };
        const created: LangyGithubInstallationRow = {
          ...input,
          suspendedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        byId.set(input.installationId, created);
        return { wasInserted: true, row: created };
      },
    ),
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
  it("maps GitHub's installation metadata onto the atomic insert", async () => {
    const repo = makeRepo();
    const svc = new LangyGithubInstallationsService(repo, makeAppTokens());
    const result = await svc.recordInstallation({
      installationId: "inst-1",
      organizationId: "org-1",
    });
    expect(result.accountLogin).toBe("acme");
    expect(repo.insertOrGetExisting).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        organizationId: "org-1",
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "all",
      }),
    );
    // A brand-new installation is claimed by the atomic insert alone — the
    // same-org refresh path (`upsert`) never runs.
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  describe("when the installation is already owned by a different organization", () => {
    it("rejects the rebind and never upserts (cross-tenant takeover guard)", async () => {
      // inst-1 already belongs to org-1; a /setup call bound to org-2 (an
      // attacker's own org, with a valid signed state) must not steal it.
      const repo = makeRepo([row({ installationId: "inst-1", organizationId: "org-1" })]);
      const svc = new LangyGithubInstallationsService(repo, makeAppTokens());

      await expect(
        svc.recordInstallation({
          installationId: "inst-1",
          organizationId: "org-2",
        }),
      ).rejects.toBeInstanceOf(LangyGithubInstallationConflictError);

      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });

  describe("when two organizations race for the same fresh installation", () => {
    it("lets only the first writer claim it; the second sees the committed org and rejects", async () => {
      // Pins the SERVICE's interpretation of an atomic repo result: given a
      // repo that reports "claimed" for exactly one caller, the service must
      // reject the other with the conflict error rather than, say, both
      // succeeding or both throwing. The fake models atomicity synchronously
      // (see its comment above) to exercise that branch — it does NOT prove
      // Postgres actually serializes the concurrent writes; that guarantee is
      // proven against a real database in
      // langy-github-installations.prisma.repository.integration.test.ts.
      const repo = makeRepo();
      // The stub must echo back the requested id — the default stub returns a
      // fixed "inst-1" regardless of input, which would key both calls' rows
      // under the same constant and hide the race this test exists to catch.
      const appTokens = makeAppTokens({
        getInstallation: vi.fn(async (installationId: string) => ({
          installationId,
          accountLogin: "acme",
          accountType: "Organization",
          accountId: "9000",
          repositorySelection: "all",
        })),
      });
      const svc = new LangyGithubInstallationsService(repo, appTokens);

      const results = await Promise.allSettled([
        svc.recordInstallation({
          installationId: "inst-race",
          organizationId: "org-a",
        }),
        svc.recordInstallation({
          installationId: "inst-race",
          organizationId: "org-b",
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        LangyGithubInstallationConflictError,
      );

      // Exactly one org ends up owning the installation — never both, never
      // neither.
      const winner = await repo.findByInstallationId("inst-race");
      expect(["org-a", "org-b"]).toContain(winner?.organizationId);
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });

  describe("when the same organization re-installs the same installation", () => {
    it("upserts cleanly (no conflict on a genuine re-install)", async () => {
      const repo = makeRepo([row({ installationId: "inst-1", organizationId: "org-1" })]);
      const svc = new LangyGithubInstallationsService(repo, makeAppTokens());

      await svc.recordInstallation({
        installationId: "inst-1",
        organizationId: "org-1",
      });

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          installationId: "inst-1",
          organizationId: "org-1",
        }),
      );
    });
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
