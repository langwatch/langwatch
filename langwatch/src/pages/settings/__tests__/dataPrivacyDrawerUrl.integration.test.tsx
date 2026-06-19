/**
 * @vitest-environment jsdom
 *
 * The privacy rule drawer is URL-routed like every other drawer (see
 * dev/docs/best_practices/drawers.md). The page opens it through `openDrawer`
 * so the active rule lives in the URL, and the registered wrapper rebuilds the
 * drawer from those URL params alone, so a pasted link reopens the same rule.
 * These render the real page and wrapper and assert the drawer-routing calls,
 * mirroring DrawerNavigation.integration.test.tsx.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { snapshot, mockOpenDrawer, mockCloseDrawer, mockSetForScope } =
  vi.hoisted(() => {
    const cat = { disposition: "capture" as const, audience: {} };
    const baseline = {
      categories: { input: cat, output: cat, system: cat, tools: cat },
      pii: { level: "essential" as const, entities: [] },
      secrets: { enabled: true, customPatterns: [] },
      customAttributes: [],
    };
    return {
      mockOpenDrawer: vi.fn(),
      mockCloseDrawer: vi.fn(),
      mockSetForScope: vi.fn(),
      snapshot: {
        available: {
          organization: { id: "org-1", name: "Acme" },
          departments: [],
          teams: [{ id: "team-1", name: "Platform" }],
          projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
        },
        audienceOptions: { groups: [] },
        effective: baseline,
        effectiveTeam: baseline,
        effectiveOrganization: baseline,
        rules: [
          {
            scopeType: "TEAM" as const,
            scopeId: "team-1",
            name: "Platform",
            personalOnly: false,
            config: { categories: { input: { disposition: "drop" as const } } },
          },
        ],
      },
    };
  });

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockCloseDrawer,
    goBack: vi.fn(),
    canGoBack: false,
    drawerOpen: vi.fn(() => false),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", teamId: "team-1", slug: "web-app" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("~/hooks/useUrlScopeFilter", () => ({
  useUrlScopeFilter: () => [{ kind: "all" }, vi.fn()],
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/settings/ScopeFilter", () => ({
  ScopeFilter: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      dataPrivacy: { getSnapshot: { invalidate: vi.fn() } },
    }),
    dataPrivacy: {
      getSnapshot: {
        useQuery: () => ({ data: snapshot, isLoading: false }),
      },
      removeForScope: {
        useMutation: () => ({ mutateAsync: vi.fn(), isLoading: false }),
      },
      setForScope: {
        useMutation: () => ({ mutateAsync: mockSetForScope, isLoading: false }),
      },
    },
  },
}));

import { DataPrivacyRuleDrawer } from "~/components/settings/DataPrivacyRuleDrawer";
import { DataPrivacyPage } from "../data-privacy";

const renderWithChakra = (ui: React.ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

describe("Privacy rule drawer URL routing", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  describe("when an admin opens the add flow from the page", () => {
    /** @scenario Opening the add flow reflects in the URL */
    it("routes to the drawer with no scope params", async () => {
      const user = userEvent.setup();
      renderWithChakra(<DataPrivacyPage projectId="proj-1" />);

      await user.click(
        screen.getByRole("button", { name: "Add privacy rule" }),
      );

      expect(mockOpenDrawer).toHaveBeenCalledWith("dataPrivacyRule", {});
    });
  });

  describe("when an admin opens a rule to edit from the page", () => {
    /** @scenario Opening a rule to edit reflects in the URL */
    it("routes to the drawer carrying the rule's scope", async () => {
      const user = userEvent.setup();
      renderWithChakra(<DataPrivacyPage projectId="proj-1" />);

      await user.click(
        screen.getByRole("button", {
          name: "Actions for Platform privacy rule",
        }),
      );
      await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

      expect(mockOpenDrawer).toHaveBeenCalledWith("dataPrivacyRule", {
        editScopeType: "TEAM",
        editScopeId: "team-1",
        editPersonalOnly: "false",
      });
    });
  });

  describe("when a shared link carries the drawer for a team scope", () => {
    /** @scenario A shared link reopens the same rule */
    it("rebuilds the drawer showing that team rule from the URL alone", () => {
      renderWithChakra(
        <DataPrivacyRuleDrawer
          editScopeType="TEAM"
          editScopeId="team-1"
          editPersonalOnly="false"
        />,
      );

      expect(screen.getByText("Edit privacy rule")).toBeInTheDocument();
      expect(screen.getByLabelText("Input").textContent).toContain("Dropped");
    });
  });

  describe("when the admin closes the drawer", () => {
    /** @scenario Closing the drawer clears it from the URL */
    it("clears the drawer from the URL", async () => {
      const user = userEvent.setup();
      renderWithChakra(
        <DataPrivacyRuleDrawer
          editScopeType="TEAM"
          editScopeId="team-1"
          editPersonalOnly="false"
        />,
      );

      // Wait for the drawer to mount before dispatching Escape, then allow the
      // close handler to fire — both are async on loaded CI runners, where the
      // original bare assertion raced and flaked (passes locally in isolation).
      await screen.findByText("Edit privacy rule");
      await user.keyboard("{Escape}");

      await waitFor(() => expect(mockCloseDrawer).toHaveBeenCalled());
    });
  });
});
