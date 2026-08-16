/**
 * @vitest-environment jsdom
 *
 * The navigation-v2 sidebar frame and its product bodies: Quick Search
 * first, the active product's real navigation components (so the legacy
 * chrome and the new shells cannot drift), and the pinned bottom block.
 *
 * Spec: specs/navigation/product-sidebars.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/[project]";

const personalTeam = {
  id: "team_p",
  name: "Personal Workspace",
  slug: "personal-ada",
  isPersonal: true,
  ownerUserId: "user_1",
  members: [{ userId: "user_1", role: "ADMIN" }],
  projects: [
    {
      id: "project_p",
      slug: "personal-ada",
      name: "Personal Workspace",
      isPersonal: true,
    },
  ],
};
const team = {
  id: "team_1",
  name: "Core",
  slug: "core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1", role: "ADMIN" }],
  projects: [
    { id: "project_1", slug: "demo", name: "Demo", isPersonal: false },
  ],
};
const organization = {
  id: "org_1",
  name: "ACME",
  members: [{ userId: "user_1", role: "ADMIN" }],
  teams: [team, personalTeam],
};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: mockPathname,
    query: {},
    asPath: mockPathname,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: {
      user: { id: "user_1", name: "Ada", email: "ada@acme.test" },
    },
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization,
    organizations: [organization],
    team,
    project: team.projects[0],
    hasPermission: () => true,
    isPublicRoute: false,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", async () => {
  const actual = await vi.importActual<object>("~/hooks/useFeatureFlag");
  return {
    ...actual,
    useFeatureFlag: () => ({ enabled: true, isLoading: false }),
  };
});

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: { NODE_ENV: "test", IS_SAAS: true },
  }),
}));

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));

vi.mock("~/components/messages/HeaderButtons", () => ({
  useTableView: () => ({ isTableView: false }),
}));

const toggleSupportChatMock = vi.fn();
vi.mock("~/utils/crispBubblePolicy", () => ({
  toggleSupportChat: () => toggleSupportChatMock(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    limits: {
      getUsage: {
        useQuery: () => ({
          data: {
            activePlan: {
              free: true,
              maxMessagesPerMonth: 10_000,
              type: "FREE",
            },
            currentMonthMessagesCount: 100,
            usageUnit: "events",
          },
        }),
      },
    },
    user: {
      isAdmin: { useQuery: () => ({ data: { isAdmin: false } }) },
    },
    annotation: {
      getPendingItemsCount: { useQuery: () => ({ data: 0 }) },
    },
    personalWorkspaceFeatures: {
      get: { useQuery: () => ({ data: undefined }) },
    },
    ops: {
      getBadgeCounts: { useQuery: () => ({ data: undefined }) },
      getDashboardSnapshot: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

const commandBarOpenMock = vi.fn();
vi.mock("~/features/command-bar", () => ({
  useCommandBar: () => ({ open: commandBarOpenMock }),
}));

const trackEventMock = vi.fn();
vi.mock("~/utils/tracking", () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

import { ProductSidebar } from "../shell/ProductSidebar";

function renderSidebar(surface: "me" | "llm-ops" | "gateway" | "governance") {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProductSidebar surface={surface} isCompact={false} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockPathname = "/[project]";
  commandBarOpenMock.mockReset();
  toggleSupportChatMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("the product sidebar", () => {
  describe("when using the Quick Search entry", () => {
    /** @scenario Quick Search sits first and opens the command bar */
    it("opens the command bar", async () => {
      renderSidebar("llm-ops");

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Quick Search" }));

      expect(commandBarOpenMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when on an LLM Ops page", () => {
    /** @scenario The LLM Ops sidebar keeps the project sections without the Govern group */
    it("shows the project sections and no Govern group", () => {
      renderSidebar("llm-ops");

      expect(screen.getByText("Observe")).toBeInTheDocument();
      expect(screen.getByText("Test")).toBeInTheDocument();
      expect(screen.getByText("Build")).toBeInTheDocument();
      expect(screen.queryByText("Govern")).not.toBeInTheDocument();
      expect(screen.queryByText("AI Gateway")).not.toBeInTheDocument();
      expect(screen.queryByText("AI Governance")).not.toBeInTheDocument();
    });
  });

  describe("when on a Me page", () => {
    /** @scenario The Me sidebar keeps the personal pages without the Govern group */
    it("shows the personal pages and no Govern group", () => {
      mockPathname = "/me";
      renderSidebar("me");

      expect(screen.getByText("My Usage")).toBeInTheDocument();
      expect(screen.getByText("Sessions")).toBeInTheDocument();
      expect(screen.getByText("Pull Requests")).toBeInTheDocument();
      expect(screen.getByText("Configure")).toBeInTheDocument();
      expect(screen.queryByText("Govern")).not.toBeInTheDocument();
    });
  });

  describe("when on a Gateway page", () => {
    /** @scenario The Gateway sidebar promotes the gateway pages */
    it("lists the gateway pages from the shared registry", () => {
      mockPathname = "/gateway/virtual-keys";
      renderSidebar("gateway");

      expect(screen.getByText("Virtual Keys")).toBeInTheDocument();
      expect(screen.getByText("Model Providers")).toBeInTheDocument();
      expect(screen.getByText("Budgets")).toBeInTheDocument();
      expect(screen.getByText("Cache Rules")).toBeInTheDocument();
      expect(screen.getByText("Routing Policies")).toBeInTheDocument();
    });
  });

  describe("when on a Governance page", () => {
    /** @scenario The Governance sidebar promotes the governance pages */
    it("lists the governance pages from the shared registry", () => {
      mockPathname = "/governance";
      renderSidebar("governance");

      expect(screen.getByText("Overview")).toBeInTheDocument();
      expect(screen.getByText("Ingestion Sources")).toBeInTheDocument();
      expect(screen.getByText("Anomaly Rules")).toBeInTheDocument();
      expect(screen.getByText("Tool Catalog")).toBeInTheDocument();
      expect(screen.getByText("Departments")).toBeInTheDocument();
    });
  });

  describe("when the sidebar bottom block renders", () => {
    /** @scenario The sidebar bottom block keeps usage, settings, support and theme */
    it("holds the usage indicator, Settings, Support and the theme control", () => {
      renderSidebar("governance");

      expect(screen.getByText("Usage")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Settings" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Support" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radiogroup", { name: "Theme" }),
      ).toBeInTheDocument();
    });
  });
});
