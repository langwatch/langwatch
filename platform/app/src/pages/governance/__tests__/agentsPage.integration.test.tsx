/**
 * @vitest-environment jsdom
 *
 * The agents page's address contract. It was a tabbed shell — Agents and
 * Applications — and is not any more: the Applications pane read nothing and
 * listed nothing, so it went, and with one pane left the tab strip went with
 * it. What sits in the address now is which layout the fleet is drawn in
 * (?view=), under the contract the tab parameter had. These tests mount the
 * real page inside a memory router so the assertions run against the address
 * the user sees: the default is never written to the URL, and an unknown
 * value degrades to the default instead of a blank pane. No organization
 * wide agents list exists yet, so the page is an honest empty state and
 * issues no query at all.
 *
 * Most of these run with sample mode turned off, because the empty pane is
 * what the page shows without it. Sample mode now fills an empty governance
 * page by default (the section-wide rule in
 * specs/ai-governance/dashboard/governance-ui-controls.feature), so the
 * page's own sentence is only on screen once the reader has said no to the
 * sample rows. The unknown-layout case is the exception and turns sample mode
 * back on for itself: a page with nothing on it has no layout to fall back
 * to, so the assertion would pass without proving anything. Sample mode has
 * its own suite next door.
 *
 * Only the boundaries are mocked: layout chrome, feature flag, and the tRPC
 * client (which records every query the page would issue).
 *
 * Specs: specs/ai-gateway/governance/governance-home-routing.feature,
 * specs/ai-governance/dashboard/agents-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
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

describe("the agents page address contract", () => {
  describe("when a governance viewer opens the bare address", () => {
    /** @scenario "The agents page default layout stays out of the address" */
    it("shows the page's empty state and writes no view parameter", () => {
      const router = renderAgentsAt(["/governance/agents"]);

      expect(screen.getByRole("heading", { name: "Agents" })).toBeVisible();
      // The empty state by its handle, not by its sentence. The address
      // contract owns that the page arrived and is not blank; the words
      // belong to agents-page.feature, and pinning them here broke this file
      // twice.
      expect(screen.getByTestId("agents-empty")).toBeVisible();
      expect(router.state.location.search).not.toContain("view");
    });

    /**
     * The tab strip is gone, not merely unselected — and the pane behind the
     * second tab with it.
     *
     * Asserted as the absence of the ROLE rather than of the word "Agents",
     * because the heading and the tab said the same string: a text query
     * would have passed on the heading while the strip was still on screen.
     */
    /** @scenario "The agents page default layout stays out of the address" */
    it("renders no tab strip and nothing of the Applications pane", () => {
      renderAgentsAt(["/governance/agents"]);

      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByTestId("applications-empty")).toBeNull();
      expect(screen.queryByText(/application/i)).toBeNull();
    });

    /** @scenario "The agents page issues no query while no organization list exists" */
    it("issues no query", () => {
      renderAgentsAt(["/governance/agents"]);

      expect(harness.requested).toEqual([]);
    });
  });

  describe("when the address carries an unknown layout value", () => {
    /** @scenario "An unknown agents layout value falls back to the list" */
    it("renders the list instead of a blank pane", () => {
      // Sample rows on: a page with nothing on it has no layout to fall back
      // to, so without them this would pass without proving anything.
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderAgentsAt(["/governance/agents?view=nonsense"]);

      expect(screen.getByTestId("governance-agents-table")).toBeVisible();
      expect(screen.queryAllByTestId("governance-agent-card")).toHaveLength(0);
    });
  });

  describe("when the viewer lacks governance:view", () => {
    /** @scenario "The agents page is guarded on governance:view" */
    it("renders nothing of the page", () => {
      harness.permissions = ["organization:view"];
      renderAgentsAt(["/governance/agents"]);

      expect(screen.queryByRole("heading", { name: "Agents" })).toBeNull();
      expect(screen.queryByTestId("agents-empty")).toBeNull();
    });
  });
});
