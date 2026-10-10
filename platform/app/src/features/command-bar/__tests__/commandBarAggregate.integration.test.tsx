/**
 * @vitest-environment jsdom
 *
 * Quick Search offers an aggregate project (ADR-144) the same pages as its
 * navigation, which is Traces alone, and no action that creates data under
 * it. Every other kind keeps the full list.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ kind: "application" }));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "demo", kind: state.kind },
    organization: { id: "organization-1" },
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: "/[project]" }),
}));

import { useTopLevelNavigationCommands } from "../hooks/useCommandFeatureFlags";
import { useFilteredCommands } from "../hooks/useFilteredCommands";

const idsFor = (query: string) => {
  const { result } = renderHook(() =>
    useFilteredCommands(query, true, "project-1", false),
  );
  return {
    navigation: result.current.navigation.map((command) => command.id),
    actions: result.current.actions.map((command) => command.id),
  };
};

const topLevelIds = () =>
  renderHook(() => useTopLevelNavigationCommands()).result.current.map(
    (command) => command.id,
  );

const CREATE_ACTIONS = [
  "action-new-agent",
  "action-new-evaluation",
  "action-new-prompt",
  "action-new-dataset",
  "action-new-automation",
  "action-new-scenario",
];

describe("Quick Search on an aggregate project", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("given an aggregate project", () => {
    beforeEach(() => {
      state.kind = "aggregate";
    });

    describe("when the bar opens empty", () => {
      /** @scenario "Test, Build and Online Evals are hidden on the aggregate" */
      it("offers Trace Explorer and settings, as the navigation does", () => {
        const ids = topLevelIds();

        expect(ids).toContain("nav-traces-v2");
        expect(ids).toContain("nav-settings");
        for (const hidden of [
          "nav-home",
          "nav-analytics",
          "nav-online-evaluations",
          "nav-agent-testing",
          "nav-experiments",
          "nav-annotations",
          "nav-prompts",
          "nav-datasets",
          "nav-automations",
        ]) {
          expect(ids).not.toContain(hidden);
        }
      });
    });

    describe("when ana searches for analytics", () => {
      /** @scenario "Test, Build and Online Evals are hidden on the aggregate" */
      it("does not offer Analytics", () => {
        expect(idsFor("analytics").navigation).not.toContain("nav-analytics");
      });
    });

    describe("when ana lists the actions", () => {
      /** @scenario "Test, Build and Online Evals are hidden on the aggregate" */
      it("offers no action that creates data", () => {
        const { actions } = idsFor("new");

        for (const create of CREATE_ACTIONS) {
          expect(actions).not.toContain(create);
        }
        expect(actions).toContain("action-invite-member");
      });
    });
  });

  describe("given an ordinary project", () => {
    beforeEach(() => {
      state.kind = "application";
    });

    describe("when ana searches for analytics and lists the actions", () => {
      it("offers Analytics and every create action", () => {
        expect(idsFor("analytics").navigation).toContain("nav-analytics");
        expect(topLevelIds()).toContain("nav-prompts");
        const { actions } = idsFor("new");
        for (const create of CREATE_ACTIONS) {
          expect(actions).toContain(create);
        }
      });
    });
  });
});
