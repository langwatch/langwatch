/**
 * @vitest-environment jsdom
 *
 * The agents page is a tabbed shell — Agents and Applications — whose
 * selected tab is part of the address (?tab=). These tests mount the real
 * page inside a memory router so the assertions run against the address
 * the user sees: the default is never written to the URL, and an unknown
 * value degrades to the default instead of a blank pane. No organization
 * wide agents list exists yet, so each pane is an honest empty state and
 * the page issues no query at all.
 *
 * These tests run with sample mode turned off, because the empty pane is
 * what the page shows without it. Sample mode now fills an empty governance
 * page by default (the section-wide rule in
 * specs/ai-governance/dashboard/governance-ui-controls.feature), so the
 * pane's own sentence is only on screen once the reader has said no to the
 * sample cards. Sample mode has its own suite next door.
 *
 * Only the boundaries are mocked: layout chrome, feature flag, and the tRPC
 * client (which records every query the page would issue).
 *
 * Specs: specs/ai-gateway/governance/governance-home-routing.feature,
 * specs/ai-governance/dashboard/agents-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
  /** The persona under test; beforeEach resets to the delegated viewer. */
  permissions: [] as string[],
}));

/** The org-member floor plus the governance product grant. */
const VIEWER_PERMISSIONS = ["organization:view", "governance:view"];

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac =
    await vi.importActual<typeof import("~/server/api/rbac")>(
      "~/server/api/rbac",
    );
  const holds = (permission: string) =>
    rbac.hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance/agents",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const queryResult = () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              if (options?.enabled !== false)
                harness.requested.push(path.join("."));
              return queryResult();
            };
          }
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import { SAMPLE_CHOICE_KEY } from "~/components/governance/sample";

import AgentsPage from "../agents";

function renderAgentsAt(initialEntries: string[]) {
  const router = createMemoryRouter(
    [{ path: "/governance/agents", Component: AgentsPage }],
    { initialEntries },
  );
  render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={router} />
    </ChakraProvider>,
  );
  return router;
}

beforeEach(() => {
  harness.requested = [];
  harness.permissions = VIEWER_PERMISSIONS;
  // The reader has said no to the sample cards, which is what puts each
  // pane's own empty-state sentence on screen.
  window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("the agents page tab shell", () => {
  describe("when a governance viewer opens the bare address", () => {
    /** @scenario "The agents page default tab stays out of the address" */
    it("selects Agents, shows its empty state, and writes no tab parameter", () => {
      const router = renderAgentsAt(["/governance/agents"]);

      expect(screen.getByRole("heading", { name: "Agents" })).toBeVisible();
      expect(screen.getByRole("tab", { name: "Agents" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // The empty state by its handle, not by its sentence. Routing owns that
      // the right pane arrived and is not blank; the words belong to
      // agents-page.feature, and pinning them here broke this file twice.
      expect(screen.getByTestId("agents-empty")).toBeVisible();
      expect(router.state.location.search).not.toContain("tab");
    });

    /** @scenario "The agents page issues no query while no organization list exists" */
    it("issues no query", () => {
      renderAgentsAt(["/governance/agents"]);

      expect(harness.requested).toEqual([]);
    });
  });

  describe("when the Applications tab is addressed", () => {
    /** @scenario "The Applications tab is addressable" */
    it("selects Applications and shows its empty state", () => {
      renderAgentsAt(["/governance/agents?tab=applications"]);

      expect(screen.getByRole("tab", { name: "Applications" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      const empty = screen.getByTestId("applications-empty");
      expect(empty).toBeVisible();
      expect(
        within(empty).getByRole("button", { name: "Register agent" }),
      ).toBeVisible();
    });
  });

  describe("when the Applications tab is selected by click", () => {
    /** @scenario "The Applications tab is addressable" */
    it("writes the tab to the address and replaces the history entry", async () => {
      const router = renderAgentsAt(["/governance/agents"]);

      fireEvent.click(screen.getByRole("tab", { name: "Applications" }));

      await waitFor(() =>
        expect(router.state.location.search).toBe("?tab=applications"),
      );
      expect(router.state.historyAction).toBe("REPLACE");
    });
  });

  describe("when the address carries an unknown tab value", () => {
    /** @scenario "An unknown agents tab value falls back to the default" */
    it("selects Agents instead of a blank pane", () => {
      renderAgentsAt(["/governance/agents?tab=nonsense"]);

      expect(screen.getByRole("tab", { name: "Agents" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("agents-empty")).toBeVisible();
    });
  });

  describe("when the viewer lacks governance:view", () => {
    /** @scenario "The agents page is guarded on governance:view" */
    it("renders no tab shell", () => {
      harness.permissions = ["organization:view"];
      renderAgentsAt(["/governance/agents"]);

      expect(screen.queryByRole("tab", { name: "Agents" })).toBeNull();
    });
  });
});
