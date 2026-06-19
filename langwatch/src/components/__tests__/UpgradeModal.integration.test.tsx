/**
 * @vitest-environment jsdom
 *
 * The plan-limit dialog counts resources across every project in the org, so
 * its "current usage" can look wrong from inside one project. Below the usage it
 * lists the counted resources grouped by project as small gray badges that link
 * to each resource. See specs/licensing/limit-dialog-usage-breakdown.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { pushMock, breakdownData } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  breakdownData: [
    {
      projectId: "p1",
      projectName: "Project A",
      projectSlug: "project-a",
      resources: [
        { id: "d1", name: "dataset a" },
        { id: "d2", name: "dataset b" },
      ],
    },
    {
      projectId: "p2",
      projectName: "Project B",
      projectSlug: "project-b",
      resources: [{ id: "d3", name: "dataset c" }],
    },
  ],
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: pushMock, query: {} }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p1", slug: "project-a" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("~/hooks/usePlanManagementUrl", () => ({
  usePlanManagementUrl: () => ({ url: "/billing", buttonLabel: "Upgrade" }),
}));

vi.mock("~/utils/tracking", () => ({ trackEvent: vi.fn() }));

vi.mock("~/utils/api", () => ({
  api: {
    licenseEnforcement: {
      getLimitBreakdown: {
        useQuery: () => ({ data: breakdownData, isLoading: false }),
      },
    },
  },
}));

const { UpgradeModal } = await import("../UpgradeModal");

const renderModal = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <UpgradeModal
        open
        onClose={vi.fn()}
        variant={{ mode: "limit", limitType: "datasets", current: 4, max: 3 }}
      />
    </ChakraProvider>,
  );

describe("UpgradeModal limit breakdown", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when an org datasets limit is exceeded across projects", () => {
    /** @scenario The limit dialog groups the counted resources by project */
    it("shows the usage and the datasets grouped by project as gray badges", async () => {
      renderModal();

      expect(
        await screen.findByText("Current usage: 4 / 3"),
      ).toBeInTheDocument();
      expect(screen.getByText("Project A")).toBeInTheDocument();
      expect(screen.getByText("Project B")).toBeInTheDocument();
      expect(screen.getAllByTestId("limit-breakdown-badge")).toHaveLength(3);
      expect(screen.getByText("dataset a")).toBeInTheDocument();
      expect(screen.getByText("dataset c")).toBeInTheDocument();
    });

    /** @scenario A breakdown badge links to its resource */
    it("navigates to the dataset in its project when its badge is clicked", async () => {
      renderModal();

      fireEvent.click(await screen.findByText("dataset c"));

      expect(pushMock).toHaveBeenCalledWith("/project-b/datasets/d3");
    });
  });
});
