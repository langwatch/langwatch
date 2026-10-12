/**
 * @vitest-environment jsdom
 *
 * An aggregate project (ADR-144) leaves Analytics out of its navigation until
 * analytics read across its members. A direct link or a bookmark still
 * reaches the pages, and there each would draw every chart as "No data". The
 * gate renders a notice in their place and never mounts the page, so none of
 * its analytics queries run.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TopicsPage from "~/pages/[project]/analytics/topics";
import { withAggregateAnalyticsGate } from "../AggregateAnalyticsGate";

const { projectRef, analyticsQueries } = vi.hoisted(() => ({
  projectRef: {
    current: { id: "proj-1", slug: "proj", kind: "application" },
  },
  analyticsQueries: { count: 0 },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    organizationRole: "ADMIN",
    isLoading: false,
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/[project]/analytics/topics",
    query: {},
    push: vi.fn(),
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// Topics' body is a page of analytics charts; standing in for its layout
// counts every time that body would start querying.
vi.mock("~/components/GraphsLayout", () => ({
  default: () => {
    analyticsQueries.count += 1;
    return <div>Topics charts</div>;
  },
}));

const NOTICE = /Analytics across member projects is not available yet/;

const renderInChakra = (node: React.ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

afterEach(() => {
  cleanup();
  analyticsQueries.count = 0;
});

describe("withAggregateAnalyticsGate", () => {
  const Page = () => <div>Page body</div>;
  const Gated = withAggregateAnalyticsGate("Page title", Page);

  describe("given an ordinary project", () => {
    it("renders the page", () => {
      projectRef.current = { id: "proj-1", slug: "proj", kind: "application" };

      renderInChakra(<Gated />);

      expect(screen.getByText("Page body")).toBeTruthy();
      expect(screen.queryByText(NOTICE)).toBeNull();
    });
  });

  describe("given an aggregate project", () => {
    /** @scenario "A direct link to the aggregate's analytics says it is not available yet" */
    it("renders the page's heading and the notice instead of the page", () => {
      projectRef.current = { id: "agg-1", slug: "agg", kind: "aggregate" };

      renderInChakra(<Gated />);

      expect(screen.getByText("Page title")).toBeTruthy();
      expect(screen.getByText(NOTICE)).toBeTruthy();
      expect(
        screen.getByRole("link", { name: "Open Trace Explorer" }),
      ).toHaveProperty("href", expect.stringContaining("/agg/traces"));
      expect(screen.queryByText("Page body")).toBeNull();
    });
  });
});

describe("Topics page", () => {
  describe("given an ordinary project", () => {
    it("renders its charts", () => {
      projectRef.current = { id: "proj-1", slug: "proj", kind: "application" };

      renderInChakra(<TopicsPage />);

      expect(screen.getByText("Topics charts")).toBeTruthy();
    });
  });

  describe("given an aggregate project opened by a direct link", () => {
    /** @scenario "A direct link to the aggregate's analytics says it is not available yet" */
    it("says analytics are not available yet and starts no chart", () => {
      projectRef.current = { id: "agg-1", slug: "agg", kind: "aggregate" };

      renderInChakra(<TopicsPage />);

      expect(screen.getByText("Topics")).toBeTruthy();
      expect(screen.getByText(NOTICE)).toBeTruthy();
      expect(analyticsQueries.count).toBe(0);
    });
  });
});
