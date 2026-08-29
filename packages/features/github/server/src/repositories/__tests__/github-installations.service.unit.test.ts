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
  GithubInstallationConflictError,
  type GithubRepository,
} from "@langwatch/github-contract";
import {
  GithubAppTokenAdapter,
  type GithubInstallationDetails,
  GithubInstallationNotFoundError,
  type GithubInstallationToken,
  GithubRateLimitedError,
  type MintInstallationTokenInput,
} from "../../adapters/github-app-token.adapter";
import type {
  GithubInstallationRow,
  GithubInstallationsRepository,
  UpsertGithubInstallationInput,
} from "../github-installations.repository";
import { GithubInstallationsService } from "../../services/github-installations.service";
import { GithubInstallationAccessService } from "../../services/github-installation-access.service";
import { TestOrganizationService } from "../../services/__tests__/fixtures/github-services.fixture";

function makeRepo(rows: GithubInstallationRow[] = []): GithubInstallationsRepository & {
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
    tryFindByInstallationId: vi.fn(async (id: string) => byId.get(id) ?? null),
    upsert: vi.fn(async (_i: UpsertGithubInstallationInput) => {}),
    // Mirrors the real unique-index semantics: the read (`byId.get`) and the
    // write (`byId.set`) below have no `await` between them, so this function
    // body runs to completion in one microtask turn — exactly like a DB
    // unique-constraint `INSERT` — which is what makes the race test below a
    // real regression test rather than a coincidence of mock timing.
    insertOrGetExisting: vi.fn(async (input: UpsertGithubInstallationInput) => {
      const existing = byId.get(input.installationId);
      if (existing) return { wasInserted: false, row: existing };
      const created: GithubInstallationRow = {
        ...input,
        suspendedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      byId.set(input.installationId, created);
      return { wasInserted: true, row: created };
    }),
    setRepositories: vi.fn(async () => {}),
    setSuspended: vi.fn(async () => {}),
    deleteByInstallationId: vi.fn(async () => 1),
  };
}

function row(over: Partial<GithubInstallationRow> = {}): GithubInstallationRow {
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

const organizations = new TestOrganizationService();

function makeAppTokens(
  over: Partial<{
    configured: boolean;
    getInstallation: (installationId: string) => Promise<GithubInstallationDetails>;
    mintInstallationToken: (
      input: MintInstallationTokenInput,
    ) => Promise<GithubInstallationToken>;
    listInstallationRepositories: (installationId: string) => Promise<GithubRepository[]>;
  }> = {},
): GithubAppTokenAdapter {
  const tokens = GithubAppTokenAdapter.create("app-1", "test-private-key", null);

  vi.spyOn(tokens, "configured", "get").mockReturnValue(over.configured ?? true);
  vi.spyOn(tokens, "getInstallation").mockImplementation(
    over.getInstallation ??
      vi.fn(async () => ({
        installationId: "inst-1",
        accountLogin: "acme",
        accountType: "Organization",
        accountId: "9000",
        repositorySelection: "all",
      })),
  );
  vi.spyOn(tokens, "mintInstallationToken").mockImplementation(
    over.mintInstallationToken ??
      vi.fn(async () => ({ token: "ghs_tok", expiresAt: "" })),
  );
  vi.spyOn(tokens, "listInstallationRepositories").mockImplementation(
    over.listInstallationRepositories ??
      vi.fn(async () => [{ id: "77", fullName: "acme/service-x" }]),
  );

  return tokens;
}

function service(
  repo: GithubInstallationsRepository,
  appTokens: GithubAppTokenAdapter,
): GithubInstallationsService {
  const access = GithubInstallationAccessService.create(repo, appTokens);
  return GithubInstallationsService.create(repo, appTokens, organizations, access);
}

describe("recordInstallation", () => {
  it("maps GitHub's installation metadata onto the atomic insert", async () => {
    const repo = makeRepo();
    const svc = service(repo, makeAppTokens());
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
    /** @scenario "An installation cannot be rebound across organizations" */
    it("rejects the rebind and never upserts (cross-tenant takeover guard)", async () => {
      // inst-1 already belongs to org-1; a /setup call bound to org-2 (an
      // attacker's own org, with a valid signed state) must not steal it.
      const repo = makeRepo([row({ installationId: "inst-1", organizationId: "org-1" })]);
      const svc = service(repo, makeAppTokens());

      await expect(
        svc.recordInstallation({
          installationId: "inst-1",
          organizationId: "org-2",
        }),
      ).rejects.toBeInstanceOf(GithubInstallationConflictError);

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
      // github-installations.prisma.repository.integration.test.ts.
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
      const svc = service(repo, appTokens);

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
        GithubInstallationConflictError,
      );

      // Exactly one org ends up owning the installation — never both, never
      // neither.
      const winner = await repo.tryFindByInstallationId("inst-race");
      expect(["org-a", "org-b"]).toContain(winner?.organizationId);
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });

  describe("when the same organization re-installs the same installation", () => {
    it("upserts cleanly (no conflict on a genuine re-install)", async () => {
      const repo = makeRepo([row({ installationId: "inst-1", organizationId: "org-1" })]);
      const svc = service(repo, makeAppTokens());

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

describe("listRepositoriesForOrganization", () => {
  describe("when every installation the org has is suspended", () => {
    it("names the suspension instead of answering with an empty list", async () => {
      const repo = makeRepo([row({ suspendedAt: new Date() })]);
      const svc = service(repo, makeAppTokens());

      await expect(svc.listRepositoriesForOrganization("org-1")).rejects.toMatchObject({
        code: "github_installation_suspended",
      });
    });
  });

  describe("when GitHub is rate limiting us", () => {
    it("says so rather than reporting no repositories", async () => {
      const repo = makeRepo([row()]);
      const svc = service(
        repo,
        makeAppTokens({
          listInstallationRepositories: vi.fn(async () => {
            throw new GithubRateLimitedError({
              retryAfterSec: 30,
              resetAt: null,
            });
          }),
        }),
      );

      await expect(svc.listRepositoriesForOrganization("org-1")).rejects.toMatchObject({
        code: "github_rate_limited",
      });
    });
  });

  describe("when the org has no installation at all", () => {
    it("answers with an empty list", async () => {
      const repo = makeRepo([]);
      const svc = service(repo, makeAppTokens());

      expect(await svc.listRepositoriesForOrganization("org-1")).toEqual([]);
    });
  });
});

describe("handleWebhookEvent", () => {
  describe("when the installation is deleted", () => {
    /** @scenario "Uninstalling removes the installation" */
    it("removes the row", async () => {
      const repo = makeRepo([row()]);
      const svc = service(repo, makeAppTokens());
      await svc.handleWebhookEvent({
        action: "deleted",
        installationId: "inst-1",
      });
      expect(repo.deleteByInstallationId).toHaveBeenCalledWith("inst-1");
    });
  });

  describe("when the installation is suspended", () => {
    it("flags it suspended", async () => {
      const repo = makeRepo([row()]);
      const svc = service(repo, makeAppTokens());
      await svc.handleWebhookEvent({
        action: "suspend",
        installationId: "inst-1",
      });
      expect(repo.setSuspended).toHaveBeenCalledWith({
        installationId: "inst-1",
        suspended: true,
      });
    });
  });

  describe("when repositories are added to a known installation", () => {
    /** @scenario "Webhook keeps the repository selection fresh" */
    it("re-reads the authoritative selection from GitHub and stores it", async () => {
      const repo = makeRepo([row({ repositorySelection: "selected" })]);
      const svc = service(
        repo,
        makeAppTokens({
          getInstallation: vi.fn(async () => ({
            installationId: "inst-1",
            accountLogin: "acme",
            accountType: "Organization",
            accountId: "9000",
            repositorySelection: "selected",
          })),
          listInstallationRepositories: vi.fn(async () => [
            { id: "77", fullName: "acme/service-x" },
            { id: "78", fullName: "acme/service-y" },
          ]),
        }),
      );

      await svc.handleWebhookEvent({
        action: "added",
        installationId: "inst-1",
      });

      expect(repo.setRepositories).toHaveBeenCalledWith({
        installationId: "inst-1",
        repositorySelection: "selected",
        repositories: [
          { id: "77", fullName: "acme/service-x" },
          { id: "78", fullName: "acme/service-y" },
        ],
      });
    });
  });

  describe("when repositories change for an unknown installation", () => {
    it("does nothing (setup callback owns first-time mapping)", async () => {
      const repo = makeRepo();
      const svc = service(repo, makeAppTokens());
      await svc.handleWebhookEvent({
        action: "added",
        installationId: "ghost",
      });
      expect(repo.setRepositories).not.toHaveBeenCalled();
    });
  });
});

describe("mintTurnToken", () => {
  describe("when the App is not configured", () => {
    it("returns null", async () => {
      const repo = makeRepo([row()]);
      const svc = service(repo, makeAppTokens({ configured: false }));
      expect(await svc.tryMintTurnToken({ organizationId: "org-1" })).toBeNull();
    });
  });

  describe("when the org has no installation", () => {
    /** @scenario "Without a connection the turn carries no GitHub credentials" */
    /** @scenario "Uninstalling removes the installation" */
    it("returns null", async () => {
      const repo = makeRepo([]);
      const svc = service(repo, makeAppTokens());
      expect(await svc.tryMintTurnToken({ organizationId: "org-1" })).toBeNull();
    });
  });

  describe("when no explicit repo is given", () => {
    /** @scenario "Langy still mints a turn token through the connection" */
    it("mints a full-installation-scoped token", async () => {
      const repo = makeRepo([row()]);
      const mint = vi.fn(async () => ({ token: "ghs_all", expiresAt: "" }));
      const svc = service(repo, makeAppTokens({ mintInstallationToken: mint }));
      const result = await svc.tryMintTurnToken({ organizationId: "org-1" });
      expect(result?.token).toBe("ghs_all");
      expect(result?.repoScopeKey).toBe(GithubAppTokenAdapter.computeRepoScopeKey({}));
      // No repository_ids ⇒ full installation scope.
      expect(mint).toHaveBeenCalledWith({ installationId: "inst-1" });
    });
  });

  describe("when an explicit repo is reachable", () => {
    /** @scenario "A Langy turn mints repository-bounded credentials from the connection" */
    it("scopes the token to only that repository", async () => {
      const repo = makeRepo([
        row({
          repositorySelection: "selected",
          repositories: [{ id: "77", fullName: "acme/service-x" }],
        }),
      ]);
      const mint = vi.fn(async () => ({ token: "ghs_one", expiresAt: "" }));
      const svc = service(repo, makeAppTokens({ mintInstallationToken: mint }));
      const result = await svc.tryMintTurnToken({
        organizationId: "org-1",
        repositoryFullName: "acme/service-x",
      });
      expect(result?.token).toBe("ghs_one");
      expect(result?.repoScopeKey).toBe(
        GithubAppTokenAdapter.computeRepoScopeKey({ repositoryIds: ["77"] }),
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
      const svc = service(repo, makeAppTokens());
      const result = await svc.tryMintTurnToken({
        organizationId: "org-1",
        repositoryFullName: "acme/other-repo",
      });
      expect(result).toBeNull();
    });
  });

  describe("when the only installation is suspended", () => {
    it("returns null", async () => {
      const repo = makeRepo([row({ suspendedAt: new Date() })]);
      const svc = service(repo, makeAppTokens());
      expect(await svc.tryMintTurnToken({ organizationId: "org-1" })).toBeNull();
    });
  });

  describe("when the oldest installation is a zombie (GitHub 404s it) but a newer one is live", () => {
    it("self-heals: removes the dead row and mints via the live installation", async () => {
      const repo = makeRepo([
        row({ installationId: "inst-dead", createdAt: new Date("2020-01-01") }),
        row({ installationId: "inst-live", createdAt: new Date("2020-01-02") }),
      ]);
      const mint = vi.fn(async ({ installationId }: { installationId: string }) => {
        if (installationId === "inst-dead") {
          throw new GithubInstallationNotFoundError(installationId);
        }
        return { token: "ghs_live", expiresAt: "" };
      });
      const svc = service(repo, makeAppTokens({ mintInstallationToken: mint }));

      const result = await svc.tryMintTurnToken({ organizationId: "org-1" });

      expect(result?.token).toBe("ghs_live");
      expect(repo.deleteByInstallationId).toHaveBeenCalledWith("inst-dead");
    });
  });

  describe("when every installation for the org is a zombie", () => {
    it("removes the dead rows and returns null (no crash, no infinite loop)", async () => {
      const repo = makeRepo([row({ installationId: "inst-dead" })]);
      const mint = vi.fn(async () => {
        throw new GithubInstallationNotFoundError("inst-dead");
      });
      const svc = service(repo, makeAppTokens({ mintInstallationToken: mint }));

      const result = await svc.tryMintTurnToken({ organizationId: "org-1" });

      expect(result).toBeNull();
      expect(repo.deleteByInstallationId).toHaveBeenCalledWith("inst-dead");
    });
  });

  describe("when the mint fails for a reason other than a confirmed 404", () => {
    it("does not delete the installation row (a transient error must not wipe a live install)", async () => {
      const repo = makeRepo([row({ installationId: "inst-1" })]);
      const mint = vi.fn(async () => {
        throw new Error("GitHub token mint failed: 500");
      });
      const svc = service(repo, makeAppTokens({ mintInstallationToken: mint }));

      const result = await svc.tryMintTurnToken({ organizationId: "org-1" });

      expect(result).toBeNull();
      expect(repo.deleteByInstallationId).not.toHaveBeenCalled();
    });
  });

  describe("when an explicit repo is only cached under a zombie installation but a live installation also has it", () => {
    it("removes the dead row and mints via the live installation", async () => {
      const repo = makeRepo([
        row({
          installationId: "inst-dead",
          createdAt: new Date("2020-01-01"),
          repositorySelection: "selected",
          repositories: [{ id: "77", fullName: "acme/service-x" }],
        }),
        row({
          installationId: "inst-live",
          createdAt: new Date("2020-01-02"),
          repositorySelection: "selected",
          repositories: [{ id: "77", fullName: "acme/service-x" }],
        }),
      ]);
      const mint = vi.fn(async ({ installationId }: { installationId: string }) => {
        if (installationId === "inst-dead") {
          throw new GithubInstallationNotFoundError(installationId);
        }
        return { token: "ghs_live", expiresAt: "" };
      });
      const svc = service(repo, makeAppTokens({ mintInstallationToken: mint }));

      const result = await svc.tryMintTurnToken({
        organizationId: "org-1",
        repositoryFullName: "acme/service-x",
      });

      expect(result?.token).toBe("ghs_live");
      expect(repo.deleteByInstallationId).toHaveBeenCalledWith("inst-dead");
    });
  });

  describe('when an explicit repo requires a live listing (an "all"-selection installation, nothing cached) and that installation is dead', () => {
    it("removes the dead row and mints via the live installation", async () => {
      const repo = makeRepo([
        row({
          installationId: "inst-dead",
          createdAt: new Date("2020-01-01"),
          repositorySelection: "all",
          repositories: null,
        }),
        row({
          installationId: "inst-live",
          createdAt: new Date("2020-01-02"),
          repositorySelection: "selected",
          repositories: [{ id: "77", fullName: "acme/service-x" }],
        }),
      ]);
      // resolveRepositoryId has no cache to consult for inst-dead ("all"
      // selection), so it falls through to listInstallationRepositories —
      // which itself mints a token first, surfacing the same 404.
      const listInstallationRepositories = vi.fn(async (installationId: string) => {
        if (installationId === "inst-dead") {
          throw new GithubInstallationNotFoundError(installationId);
        }
        return [{ id: "77", fullName: "acme/service-x" }];
      });
      const mint = vi.fn(async () => ({ token: "ghs_live", expiresAt: "" }));
      const svc = service(
        repo,
        makeAppTokens({
          listInstallationRepositories,
          mintInstallationToken: mint,
        }),
      );

      const result = await svc.tryMintTurnToken({
        organizationId: "org-1",
        repositoryFullName: "acme/service-x",
      });

      expect(result?.token).toBe("ghs_live");
      expect(repo.deleteByInstallationId).toHaveBeenCalledWith("inst-dead");
    });
  });
});
