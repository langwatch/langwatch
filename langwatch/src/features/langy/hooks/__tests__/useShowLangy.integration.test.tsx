/**
 * @vitest-environment jsdom
 *
 * useShowLangy is Langy's UI visibility gate. #5966 made access flag-only (no
 * identity bypass), which means the gate must resolve `release_langy_enabled`
 * with the SAME project + organization context the server-side hasLangyAccess
 * gate uses. Otherwise an org-wide rollout authorizes the tRPC procedures while
 * the handle stays hidden — the exact asymmetry this test locks out.
 *
 * The `useFeatureFlag` mock reproduces the flag store's rule matcher
 * (server/featureFlag/rules.ts): a targeting rule only matches when every id it
 * constrains is present in, and equal to, the evaluation context.
 *
 * Spec: specs/langy/langy-baseline.feature ("Access and rollout gating")
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FlagOptions = {
  projectId?: string;
  organizationId?: string;
  enabled?: boolean;
};

// Boundary state, set per test. A `null` rule means "no rollout"; a rule with
// only organizationId is an org-wide rollout, with only projectId a per-project
// rollout.
const gate: {
  rule: { projectId?: string; organizationId?: string } | null;
  lastFlagOptions: FlagOptions | undefined;
} = {
  rule: null,
  lastFlagOptions: undefined,
};

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (_flag: string, options: FlagOptions) => {
    gate.lastFlagOptions = options;
    // Callers gated out upstream disable the query — mirror that short-circuit.
    if (options?.enabled === false) return { enabled: false, isLoading: false };
    const rule = gate.rule;
    const matches =
      rule !== null &&
      (rule.projectId === undefined || rule.projectId === options?.projectId) &&
      (rule.organizationId === undefined ||
        rule.organizationId === options?.organizationId);
    return { enabled: matches, isLoading: false };
  },
}));

// Mutable so a later describe block can swap in an unresolved-project shape
// without a second vi.mock (hoisting only allows one factory per module).
const context = {
  project: { id: "project-1", slug: "acme" } as
    | { id: string; slug: string }
    | undefined,
  demoProjectSlug: "not-this-project" as string | undefined,
};

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    get project() {
      return context.project;
    },
    team: {
      isPersonal: false,
      ownerUserId: "someone-else",
      members: [{ userId: "user-1" }],
    },
    organization: { id: "org-1" },
    organizationRole: "MEMBER",
    hasPermission: (permission: string) => permission === "langy:view",
  }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    get data() {
      return { DEMO_PROJECT_SLUG: context.demoProjectSlug };
    },
  }),
}));

import { useShowLangy } from "../useShowLangy";

afterEach(() => {
  cleanup();
  gate.rule = null;
  gate.lastFlagOptions = undefined;
  context.project = { id: "project-1", slug: "acme" };
  context.demoProjectSlug = "not-this-project";
});

describe("useShowLangy", () => {
  describe("given a team member with langy:view on a non-demo project", () => {
    describe("when the rollout targets the whole organization and no project rule applies", () => {
      it("reveals the panel by resolving the flag with organization context", () => {
        gate.rule = { organizationId: "org-1" };

        const { result } = renderHook(() => useShowLangy());

        expect(result.current).toBe(true);
        expect(gate.lastFlagOptions?.organizationId).toBe("org-1");
      });
    });

    describe("when the rollout targets only the current project", () => {
      it("reveals the panel", () => {
        gate.rule = { projectId: "project-1" };

        const { result } = renderHook(() => useShowLangy());

        expect(result.current).toBe(true);
      });
    });

    describe("when the rollout targets a different organization", () => {
      it("keeps the panel hidden", () => {
        gate.rule = { organizationId: "other-org" };

        const { result } = renderHook(() => useShowLangy());

        expect(result.current).toBe(false);
      });
    });

    describe("when nothing has been rolled out", () => {
      it("keeps the panel hidden", () => {
        gate.rule = null;

        const { result } = renderHook(() => useShowLangy());

        expect(result.current).toBe(false);
      });
    });
  });

  describe("when the active project has not resolved yet", () => {
    beforeEach(() => {
      context.project = undefined;
      context.demoProjectSlug = undefined;
    });

    // `DEMO_PROJECT_SLUG === project?.slug` with both sides undefined must
    // not read as "this is the demo project". An install with no demo
    // project configured hits exactly this on any route whose project
    // hasn't resolved yet, and did not deserve to lose Langy for it.
    /** @scenario The handle stays visible while the active project is still loading */
    it("does not treat the unresolved project as the demo project", () => {
      gate.rule = { organizationId: "org-1" };

      const { result } = renderHook(() => useShowLangy());

      expect(result.current).toBe(true);
    });
  });
});
