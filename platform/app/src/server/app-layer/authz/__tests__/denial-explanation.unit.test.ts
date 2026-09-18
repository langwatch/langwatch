/** @vitest-environment node */

/**
 * ADR-092 section 6 rendered for the person who was refused.
 *
 * The sharp part is the SPLIT. The engine's walk names scope ids, group ids
 * and the bindings the chain filtered out; the customer gets role labels and
 * nothing else. These pin that boundary, the chain filter the labels are
 * derived through, and that every failure path answers null rather than
 * turning a refusal into a failed request.
 */
import type { AuthzDecision, AuthzScopeRef } from "@langwatch/authz";
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkDetailed = vi.fn();
const explainDecision = vi.fn();
const resolveScopeRef = vi.fn();

// The composition root reaches Prisma and Redis at module scope. What this
// suite owns is the shaping of the answer, not the collecting of it.
vi.mock("../runtime", () => ({
  authz: {
    checkDetailed: (...args: unknown[]) => checkDetailed(...args),
    explainDecision: (...args: unknown[]) => explainDecision(...args),
  },
  authzCollector: {
    resolveScopeRef: (...args: unknown[]) => resolveScopeRef(...args),
  },
}));

const { explainDenial } = await import("../denial-explanation");

beforeEach(() => {
  vi.clearAllMocks();
});

const PROJECT_SCOPE: AuthzScopeRef = {
  type: "project",
  id: "proj-1",
  teamId: "team-1",
  organizationId: "org-1",
};

const principal = { type: "user", id: "dana" } as const;

const binding = (over: Record<string, unknown> = {}) => ({
  role: "VIEWER",
  customRoleId: null,
  scopeType: "TEAM",
  scopeId: "team-1",
  ...over,
});

const grantsWith = (bindings: unknown[]) => ({
  principal,
  organizationId: "org-1",
  organizationRole: "MEMBER",
  isOrgMember: true,
  membershipDisabled: false,
  bindings,
  legacyTeamMemberships: [],
  customRolePermissions: new Map(),
});

const denial = (scope: AuthzScopeRef, permission: string) =>
  ({
    allowed: false,
    permission,
    scope,
    principal,
    audience: "member",
    denialReason: "no-binding",
  }) as AuthzDecision;

const arrange = ({
  scope = PROJECT_SCOPE,
  bindings = [binding()],
  permission = "traces:share",
}: {
  scope?: AuthzScopeRef | null;
  bindings?: unknown[];
  permission?: string;
} = {}) => {
  resolveScopeRef.mockResolvedValue(scope);
  checkDetailed.mockResolvedValue({
    decision: denial(scope ?? PROJECT_SCOPE, permission),
    grants: grantsWith(bindings),
  });
  explainDecision.mockResolvedValue([
    "DENIED traces:share @ project proj-1",
    "  - viewer @ team team-1 (via group sec-eng) - does not grant traces:share",
  ]);
};

type Ask = Parameters<typeof explainDenial>[0];

const ask = (over: Partial<Ask> = {}) =>
  explainDenial({
    userId: "dana",
    permission: "traces:share",
    scope: { tier: "project", id: "proj-1" },
    ...over,
  } as Ask);

describe("explainDenial", () => {
  describe("given a member whose role on the chain falls short", () => {
    /** @scenario "A denied member is told which of their roles fell short" */
    it("names the role they hold and the roles that would grant it", async () => {
      arrange();

      const explanation = await ask();

      expect(explanation).toEqual({
        heldRoles: ["Viewer"],
        wouldGrantRoles: ["Admin", "Member"],
      });
    });

    /** @scenario "The explanation names roles, never the bindings behind them" */
    it("carries no scope id, group id or engine prose", async () => {
      arrange();

      const rendered = JSON.stringify(await ask());

      expect(rendered).not.toContain("proj-1");
      expect(rendered).not.toContain("team-1");
      expect(rendered).not.toContain("sec-eng");
      expect(rendered).not.toContain("DENIED");
      // The walk is still rendered - for the operator, on a log line. That is
      // what makes the absence above a decision rather than an oversight.
      expect(explainDecision).toHaveBeenCalled();
    });

    /** @scenario "The explanation names roles, never the bindings behind them" */
    it("ignores bindings the scope chain filtered out", async () => {
      arrange({
        bindings: [
          binding(),
          binding({ role: "ADMIN", scopeType: "TEAM", scopeId: "other-team" }),
        ],
      });

      // Admin off the chain is not a role they hold HERE, and reporting it
      // would tell them they already have what they were just refused.
      expect((await ask())?.heldRoles).toEqual(["Viewer"]);
    });

    /** @scenario "The explanation names roles, never the bindings behind them" */
    it("renders a custom role under the product word, never its id", async () => {
      arrange({
        bindings: [binding({ role: "CUSTOM", customRoleId: "role_sre_42" })],
      });

      const explanation = await ask();

      expect(explanation?.heldRoles).toEqual(["Custom"]);
      expect(JSON.stringify(explanation)).not.toContain("role_sre_42");
    });

    /** @scenario "A denied member is told which of their roles fell short" */
    it("names the organization roles when the refusal was at that tier", async () => {
      const orgScope: AuthzScopeRef = { type: "organization", id: "org-1" };
      arrange({
        scope: orgScope,
        bindings: [],
        permission: "organization:manage",
      });

      const explanation = await ask({
        permission: "organization:manage",
        scope: { tier: "organization", id: "org-1" },
      });

      expect(explanation).toEqual({
        heldRoles: [],
        wouldGrantRoles: ["Organization admin"],
      });
    });
  });
});

describe("explainDenial, when it cannot answer", () => {
  /** @scenario "The denial still works when the explanation cannot be computed" */
  it("answers null for a scope id that resolves to nothing", async () => {
    arrange({ scope: null });

    // Saying anything at all here would tell a caller whether the id EXISTS,
    // which is the one thing the denial shape is built to withhold.
    expect(await ask()).toBeNull();
    expect(checkDetailed).not.toHaveBeenCalled();
  });

  /** @scenario "The denial still works when the explanation cannot be computed" */
  it("answers null when the collector throws", async () => {
    resolveScopeRef.mockRejectedValue(new Error("collector unavailable"));

    expect(await ask()).toBeNull();
  });

  /** @scenario "The denial still works when the explanation cannot be computed" */
  it("answers null when the grant landed after the check", async () => {
    arrange();
    checkDetailed.mockResolvedValue({
      decision: { ...denial(PROJECT_SCOPE, "traces:share"), allowed: true },
      grants: grantsWith([binding()]),
    });

    // Explaining a denial that no longer holds would read as nonsense.
    expect(await ask()).toBeNull();
  });

  /** @scenario "The denial still works when the explanation cannot be computed" */
  it("still answers when only the operator-facing walk fails", async () => {
    arrange();
    explainDecision.mockRejectedValue(new Error("walk unavailable"));

    // The two audiences fail independently: a log-line failure must not cost
    // the customer their copy.
    expect(await ask()).toEqual({
      heldRoles: ["Viewer"],
      wouldGrantRoles: ["Admin", "Member"],
    });
  });
});
