/** @vitest-environment node */

/**
 * The runtime lineage guard behind every tRPC permission check: one request
 * may not carry scope ids from more than one organization, whatever kind of
 * declaration fronts the procedure.
 *
 * @see specs/rbac/typed-permission-declarations.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineagePrisma } from "../scope-lineage-guard";
import { scopeLineageGuard } from "../scope-lineage-guard";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn }),
}));

function harness({
  teams = {},
  projects = {},
}: {
  /** teamId → organizationId */
  teams?: Record<string, string>;
  /** projectId → organizationId */
  projects?: Record<string, string>;
} = {}) {
  const prisma = {
    team: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        teams[where.id] ? { organizationId: teams[where.id] } : null,
      ),
    },
    project: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        projects[where.id]
          ? { team: { organizationId: projects[where.id] } }
          : null,
      ),
    },
  };
  const next = vi.fn().mockResolvedValue("handled");
  return { prisma, next };
}

async function run({
  input,
  harnessArgs,
}: {
  input: unknown;
  harnessArgs?: Parameters<typeof harness>[0];
}) {
  const { prisma, next } = harness(harnessArgs);
  const guard = scopeLineageGuard({
    kind: "permission",
    permission: "auditLog:view",
  });
  // The mock carries only the two `findUnique`s the guard reads; cast to the
  // delegate shape it declares, keeping the raw mock for the assertions.
  const result = guard({
    ctx: { prisma: prisma as unknown as LineagePrisma },
    input,
    next,
  });
  return { prisma, next, result };
}

const expectPermissionDenied = async (result: Promise<unknown>) => {
  // biome-ignore lint/suspicious/noMisplacedAssertion: one shared shape for every cross-tenant refusal; the assertion belongs with the shape it checks
  await expect(result).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    cause: expect.objectContaining({
      code: "permission_denied",
      meta: expect.objectContaining({ permission: "auditLog:view" }),
    }),
  });
};

describe("the scope lineage guard", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when one request carries scope ids from two organizations", () => {
    /** @scenario "Scope ids from two organizations in one request are refused" */
    it("refuses before the handler runs, shaped as a permission denial, and logs both", async () => {
      const { next, result } = await run({
        input: { organizationId: "org_victim", projectId: "project_mine" },
        harnessArgs: { projects: { project_mine: "org_attacker" } },
      });

      await expectPermissionDenied(result);
      expect(next).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        {
          scopes: [
            {
              tier: "project",
              id: "project_mine",
              organizationId: "org_attacker",
            },
            {
              tier: "organization",
              id: "org_victim",
              organizationId: "org_victim",
            },
          ],
        },
        expect.any(String),
      );
    });

    it("refuses a team id from another organization the same way", async () => {
      const { next, result } = await run({
        input: { organizationId: "org_victim", teamId: "team_mine" },
        harnessArgs: { teams: { team_mine: "org_attacker" } },
      });

      await expectPermissionDenied(result);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when a scope id resolves to no organization at all", () => {
    /** @scenario "A scope id resolving to no organization cannot anchor a mixed request" */
    it("fails closed rather than treating the unresolvable id as agreeing", async () => {
      const { next, result } = await run({
        input: { organizationId: "org_1", projectId: "project_ghost" },
        harnessArgs: { projects: {} },
      });

      await expectPermissionDenied(result);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when every scope id resolves to one organization", () => {
    /** @scenario "A request whose scope ids agree passes the lineage guard untouched" */
    it("passes through to the declared check", async () => {
      const { next, result } = await run({
        input: {
          organizationId: "org_1",
          teamId: "team_1",
          projectId: "project_1",
        },
        harnessArgs: {
          teams: { team_1: "org_1" },
          projects: { project_1: "org_1" },
        },
      });

      await expect(result).resolves.toBe("handled");
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the input carries at most one scope id", () => {
    it("resolves nothing and passes through", async () => {
      const single = await run({ input: { projectId: "project_1" } });
      await expect(single.result).resolves.toBe("handled");
      expect(single.prisma.project.findUnique).not.toHaveBeenCalled();

      const none = await run({ input: undefined });
      await expect(none.result).resolves.toBe("handled");
    });
  });
});
