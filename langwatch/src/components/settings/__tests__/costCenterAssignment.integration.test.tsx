/**
 * @vitest-environment jsdom
 *
 * Binds the cost-center assignment UI scenarios from
 * specs/ai-gateway/governance/cost-centers.feature: the cost-centers page
 * manages centers and links out, the picker assigns from the members /
 * teams surfaces, and the control only appears once cost centers exist.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ffEnabled, costCenterList, assignments, mutations } = vi.hoisted(() => ({
  ffEnabled: { current: true },
  costCenterList: {
    current: [{ id: "cc_mkt", name: "Marketing" }] as Array<{
      id: string;
      name: string;
    }>,
  },
  assignments: {
    current: {
      users: [] as Array<{ id: string; name: string; costCenterId: string | null }>,
      teams: [] as Array<{ id: string; name: string; costCenterId: string | null }>,
      projects: [] as Array<{ id: string; name: string; costCenterId: string | null }>,
    },
  },
  mutations: {
    assignUser: vi.fn(async () => ({})),
    assignTeam: vi.fn(async () => ({})),
    assignProject: vi.fn(async () => ({})),
  },
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: ffEnabled.current, isLoading: false }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    isLoading: false,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      costCenters: {
        list: { invalidate: vi.fn() },
        assignments: { invalidate: vi.fn() },
      },
    }),
    costCenters: {
      list: {
        useQuery: () => ({ data: costCenterList.current, isLoading: false }),
      },
      assignments: {
        useQuery: () => ({ data: assignments.current, isLoading: false }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      rename: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      assignUser: {
        useMutation: () => ({ mutateAsync: mutations.assignUser, isPending: false }),
      },
      assignTeam: {
        useMutation: () => ({ mutateAsync: mutations.assignTeam, isPending: false }),
      },
      assignProject: {
        useMutation: () => ({
          mutateAsync: mutations.assignProject,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/WithFeatureFlagGuard", () => ({
  withFeatureFlagGuard: () => (C: any) => C,
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (C: any) => C,
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href?: string;
    [key: string]: any;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { default: CostCentersPage } = await import(
  "~/pages/settings/governance/cost-centers"
);
const { CostCenterPicker } = await import("../CostCenterPicker");
const { useCostCenterColumn } = await import("../useCostCenterColumn");

function renderWithChakra(node: ReactNode) {
  return render(
    <ChakraProvider value={defaultSystem}>{node}</ChakraProvider>,
  );
}

describe("cost-center assignment UI", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    ffEnabled.current = true;
    costCenterList.current = [{ id: "cc_mkt", name: "Marketing" }];
    assignments.current = { users: [], teams: [], projects: [] };
  });

  describe("given the cost-centers page", () => {
    /** @scenario The cost-centers page manages centers and links out to assign them */
    it("manages centers and links to the members and teams pages instead of listing every person", () => {
      renderWithChakra(<CostCentersPage />);

      expect(screen.getByText("Create a cost center")).toBeDefined();
      expect(
        screen.getByRole("link", { name: /People/i }).getAttribute("href"),
      ).toBe("/settings/members");
      // Anchored to the link title: the Projects link now also mentions the
      // "teams page" in its description and points to /settings/teams too.
      expect(
        screen.getByRole("link", { name: /^Teams/i }).getAttribute("href"),
      ).toBe("/settings/teams");
      expect(
        screen.getByRole("link", { name: /^Projects/i }).getAttribute("href"),
      ).toBe("/settings/teams");
      // The per-person assignment list is gone: no <select> on the page.
      expect(document.querySelector("select")).toBeNull();
    });
  });

  describe("given a member row on the members page", () => {
    /** @scenario A member is assigned to a cost center from the members page */
    it("assigns the chosen cost center to that user", () => {
      renderWithChakra(
        <CostCenterPicker
          organizationId="org-1"
          kind="user"
          entityId="user_robin"
          value={null}
          costCenters={[
            {
              id: "cc_mkt",
              name: "Marketing",
              organizationId: "org-1",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          ]}
          onAssigned={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "cc_mkt" },
      });

      expect(mutations.assignUser).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user_robin",
        costCenterId: "cc_mkt",
      });
    });
  });

  describe("given a team row on the teams page", () => {
    /** @scenario A team is assigned to a cost center from the teams page */
    it("assigns the chosen cost center to that team", () => {
      renderWithChakra(
        <CostCenterPicker
          organizationId="org-1"
          kind="team"
          entityId="team_platform"
          value={null}
          costCenters={[
            {
              id: "cc_eng",
              name: "Engineering",
              organizationId: "org-1",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          ]}
          onAssigned={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "cc_eng" },
      });

      expect(mutations.assignTeam).toHaveBeenCalledWith({
        organizationId: "org-1",
        teamId: "team_platform",
        costCenterId: "cc_eng",
      });
    });
  });

  describe("given the governance flag is on", () => {
    /** @scenario The cost-center control appears only once cost centers are configured */
    it("hides the control until the first cost center exists, then shows it", () => {
      function Harness() {
        const cc = useCostCenterColumn("org-1");
        return <div data-testid="show">{String(cc.show)}</div>;
      }

      costCenterList.current = [];
      const { rerender } = renderWithChakra(<Harness />);
      expect(screen.getByTestId("show").textContent).toBe("false");

      costCenterList.current = [{ id: "cc_mkt", name: "Marketing" }];
      rerender(
        <ChakraProvider value={defaultSystem}>
          <Harness />
        </ChakraProvider>,
      );
      expect(screen.getByTestId("show").textContent).toBe("true");
    });
  });
});
