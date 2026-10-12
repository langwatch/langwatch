/**
 * @vitest-environment jsdom
 *
 * An aggregate project (ADR-144) refuses a new chart on the server, so its
 * reports and the chart editor, reached by a direct link, offer neither "Add
 * chart" nor Save. Apart from that, a chart save the server refuses on any
 * project leaves the editor open with an error toast giving the server's
 * reason, rather than doing nothing.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHandledError, resolveErrorCopy } from "~/features/errors";
import ReportsPage from "../../reports";
import AnalyticsCustomGraph from "../index";

const { projectRef, mockCreateGraph, mockRouterPush, mockToast } = vi.hoisted(
  () => ({
    projectRef: {
      current: { id: "proj-1", slug: "proj", kind: "application" },
    },
    mockCreateGraph: vi.fn(),
    mockRouterPush: vi.fn(),
    mockToast: vi.fn(),
  }),
);

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// The chart preview renders live analytics; the editor's save is under test.
vi.mock("~/components/analytics/CustomGraph", () => ({
  CustomGraph: () => null,
  summaryGraphTypes: ["summary", "pie", "donnut"],
}));

vi.mock("~/components/filters/FilterSidebar", () => ({
  FilterSidebar: () => null,
}));

vi.mock("~/components/filters/FieldsFilters", () => ({
  FieldsFilters: () => null,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    organization: { id: "org-1" },
    team: { slug: "team-1" },
    organizationRole: "ADMIN",
    isLoading: false,
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock("~/hooks/useFilterParams", () => ({
  useFilterParams: () => ({
    filterParams: { filters: {} },
    setFilters: vi.fn(),
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/[project]/analytics/reports",
    query: {},
    push: mockRouterPush,
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mockToast },
}));

vi.mock("~/utils/api", () => ({
  api: {
    graphs: {
      getById: { useQuery: () => ({ data: null, isLoading: false }) },
      create: { useMutation: () => ({ mutate: mockCreateGraph }) },
      updateById: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    analytics: {
      getTimeseries: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
    useUtils: () => ({
      graphs: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
  },
}));

/** A save the server refused as read only, as the tRPC client receives it. */
const READ_ONLY_REFUSAL = {
  message: "aggregate_project_is_read_only",
  data: {
    error: {
      code: "aggregate_project_is_read_only",
      httpStatus: 403,
      fault: "customer",
      meta: {},
      tips: [],
      reasons: [],
    },
  },
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Adding a chart", () => {
  describe("given an aggregate project opened by a direct link", () => {
    describe("when ana opens its reports or the chart editor", () => {
      /** @scenario "The aggregate's reports offer no chart to add" */
      it("offers neither Add chart nor Save", () => {
        projectRef.current = { id: "agg-1", slug: "agg", kind: "aggregate" };

        render(
          <>
            <ReportsPage />
            <AnalyticsCustomGraph />
          </>,
          { wrapper: Wrapper },
        );

        expect(screen.queryByText(/Add chart/)).toBeNull();
        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      });
    });
  });

  describe("given a project whose server refuses the new chart", () => {
    describe("when ana saves it from the chart editor", () => {
      /** @scenario "A chart save the server refuses says why" */
      it("shows the server's reason in an error toast and stays on the editor", async () => {
        projectRef.current = {
          id: "proj-1",
          slug: "proj",
          kind: "application",
        };
        mockCreateGraph.mockImplementation(
          (_input: unknown, opts?: { onError?: (error: unknown) => void }) => {
            opts?.onError?.(READ_ONLY_REFUSAL);
          },
        );
        const user = userEvent.setup();

        render(<AnalyticsCustomGraph />, { wrapper: Wrapper });
        await user.click(await screen.findByRole("button", { name: "Save" }));

        expect(readHandledError(READ_ONLY_REFUSAL)?.code).toBe(
          "aggregate_project_is_read_only",
        );
        await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "error",
            title: resolveErrorCopy({ error: READ_ONLY_REFUSAL }).title,
          }),
        );
        expect(mockRouterPush).not.toHaveBeenCalled();
      });
    });
  });
});
