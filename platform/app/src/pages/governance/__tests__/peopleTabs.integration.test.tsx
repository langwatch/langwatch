/**
 * @vitest-environment jsdom
 *
 * The People page is a tabbed shell: a People table ranked by spend, and a
 * Departments pane. The selected tab is part of the address (?tab=), read
 * from the router's search params, so every test mounts the real page in a
 * memory router and asserts against the same address the user sees.
 *
 * Only the boundaries are mocked - layout chrome, the feature flag, the
 * plan, the compat router, and the tRPC client, which answers per procedure
 * from the harness. The permission decision is the real one:
 * `hasAnyPermission` runs the same `hasPermissionWithHierarchy` the server
 * uses.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryAnswer = {
  data?: unknown;
  error?: unknown;
  isLoading?: boolean;
};

const harness = vi.hoisted(() => ({
  /** The grants the viewer under test holds. */
  permissions: [] as string[],
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
  /** What each procedure answers; anything unlisted answers `undefined`. */
  answers: {} as Record<string, QueryAnswer>,
}));

/** The org-member floor, the governance product grant, and the spend read. */
const VIEWER_PERMISSIONS = [
  "organization:view",
  "governance:view",
  "activityMonitor:view",
  "ingestionSources:view",
];

const MANAGER_PERMISSIONS = [...VIEWER_PERMISSIONS, "governance:manage"];

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

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance/people",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const queryResult = (answer: QueryAnswer | undefined) => ({
    data: answer?.data,
    isLoading: answer?.isLoading ?? false,
    isFetching: false,
    isError: !!answer?.error,
    error: answer?.error ?? null,
    refetch: vi.fn(),
  });
  const mutationResult = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
  });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              const key = path.join(".");
              if (options?.enabled !== false) harness.requested.push(key);
              return queryResult(harness.answers[key]);
            };
          }
          if (property === "useMutation") return mutationResult;
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import PeoplePage from "../people";

const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

const JANE = {
  actor: "jane.doe@example.com",
  spendUsd: "12.5",
  requests: 1234,
  lastActivityIso: THREE_DAYS_AGO.toISOString(),
  trendVsPreviousPct: 0,
  hasPriorBaseline: false,
  mostUsedTarget: "claude-fable-5-1",
};

const SAM = {
  actor: "sam@example.com",
  spendUsd: "3",
  requests: 7,
  lastActivityIso: THREE_DAYS_AGO.toISOString(),
  trendVsPreviousPct: 0,
  hasPriorBaseline: false,
  mostUsedTarget: "Cursor",
};

function renderPeopleAt(initialEntries: string[]) {
  const router = createMemoryRouter(
    [{ path: "/governance/people", Component: PeoplePage }],
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
  harness.permissions = VIEWER_PERMISSIONS;
  harness.requested = [];
  harness.answers = {};
});

afterEach(() => cleanup());

describe("the People page tab shell", () => {
  describe("when a viewer opens the bare address", () => {
    /** @scenario "The default tab is People" */
    it("selects People, requests the table, and writes no tab parameter", () => {
      const router = renderPeopleAt(["/governance/people"]);

      expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("activityMonitor.spendByUser");
      expect(router.state.location.search).not.toContain("tab");
    });
  });

  describe("when the address names the departments tab", () => {
    /** @scenario "The Departments tab is addressable" */
    it("selects Departments and requests the department list", () => {
      renderPeopleAt(["/governance/people?tab=departments"]);

      expect(screen.getByRole("tab", { name: "Departments" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("departments.list");
      expect(harness.requested).not.toContain("activityMonitor.spendByUser");
    });
  });
});

describe("the People table", () => {
  describe("when one person used AI through a connected source", () => {
    /** @scenario "The People table renders each person with spend, requests and last activity" */
    it("lists them with spend, requests, last activity and a link to their page", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      renderPeopleAt(["/governance/people"]);

      const row = screen.getByRole("row", { name: /jane\.doe/ });
      expect(within(row).getByText("jane.doe")).toBeInTheDocument();
      expect(within(row).getByText("jane.doe@example.com")).toBeInTheDocument();
      expect(within(row).getByText("$12.50")).toBeInTheDocument();
      expect(within(row).getByText("1,234")).toBeInTheDocument();
      expect(within(row).getByText("3 days ago")).toBeInTheDocument();
      expect(
        within(row).getByRole("link", { name: "jane.doe" }),
      ).toHaveAttribute("href", "/governance/users/jane.doe%40example.com");
    });
  });

  describe("when a person matches an organization member with a department", () => {
    /** @scenario "A person matching an organization member shows that member's department" */
    it("shows the member's department, and a dash for everyone else", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE, SAM] };
      harness.answers["departments.list"] = {
        data: [{ id: "dept-1", name: "Engineering" }],
      };
      harness.answers["departments.assignments"] = {
        data: {
          users: [
            {
              id: "user-1",
              name: "Jane Doe",
              email: "jane.doe@example.com",
              departmentId: "dept-1",
            },
          ],
          teams: [],
          projects: [],
        },
      };
      renderPeopleAt(["/governance/people"]);

      const jane = screen.getByRole("row", { name: /jane\.doe/ });
      expect(within(jane).getByText("Engineering")).toBeInTheDocument();
      const sam = screen.getByRole("row", { name: /sam@/ });
      expect(within(sam).queryByText("Engineering")).not.toBeInTheDocument();
      expect(within(sam).getAllByText("—").length).toBeGreaterThan(0);
    });
  });

  describe("when a most-used target names a connected source", () => {
    /** @scenario "A most-used chip links to its source only when a source matches" */
    it("links the matching chip to the source and leaves the other plain", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE, SAM] };
      harness.answers["ingestionSources.list"] = {
        data: [{ id: "src-1", name: "Cursor", sourceType: "cursor" }],
      };
      renderPeopleAt(["/governance/people"]);

      const sam = screen.getByRole("row", { name: /sam@/ });
      expect(within(sam).getByRole("link", { name: "Cursor" })).toHaveAttribute(
        "href",
        "/governance/inventory/src-1",
      );
      const jane = screen.getByRole("row", { name: /jane\.doe/ });
      expect(within(jane).getByText("claude-fable-5-1")).toBeInTheDocument();
      expect(
        within(jane).queryByRole("link", { name: "claude-fable-5-1" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the organization's plan does not include the activity monitor", () => {
    /** @scenario "Enterprise-locked activity shows a quiet line, not an alert" */
    it("shows a muted locked line and no alert", () => {
      harness.answers["activityMonitor.spendByUser"] = {
        error: {
          error: {
            code: "enterprise_plan_required",
            message: "enterprise_plan_required",
          },
        },
      };
      renderPeopleAt(["/governance/people"]);

      const note = screen.getByRole("note");
      expect(note).toHaveTextContent(/Enterprise plan/);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
    });
  });

  describe("when nobody was active in the window", () => {
    /** @scenario "Nobody active in the window" */
    it("says so in the People tab", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [] };
      renderPeopleAt(["/governance/people"]);

      expect(
        screen.getByText(
          "No one has used AI through a connected source in the last 30 days.",
        ),
      ).toBeInTheDocument();
    });
  });
});

describe("the Departments tab", () => {
  describe("when a manager opens it", () => {
    /** @scenario "The Departments tab keeps the create box for a manager" */
    it("offers the compact create control", () => {
      harness.permissions = MANAGER_PERMISSIONS;
      renderPeopleAt(["/governance/people?tab=departments"]);

      expect(
        screen.getByRole("textbox", { name: "Create a department" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Create" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/governance:manage/)).not.toBeInTheDocument();
    });
  });

  describe("when a viewer without the manage grant opens it", () => {
    /** @scenario "The Departments tab offers no controls to a viewer without the manage grant" */
    it("offers no create control and names the grant", () => {
      harness.answers["departments.list"] = {
        data: [{ id: "dept-1", name: "Engineering" }],
      };
      renderPeopleAt(["/governance/people?tab=departments"]);

      expect(
        screen.queryByRole("textbox", { name: "Create a department" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Actions for/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Engineering")).toBeInTheDocument();
      expect(screen.getByText(/governance:manage/)).toBeInTheDocument();
    });
  });
});
