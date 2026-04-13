/**
 * @vitest-environment jsdom
 *
 * Integration tests for useFilterParams write operations.
 * Tests setFilter, clearFilters, setNegateFilters.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockRouterQuery: Record<string, string | string[] | undefined> = {};
let mockRouterAsPath = "/test-project/messages";
const mockPush = vi.fn().mockResolvedValue(true);

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    push: mockPush,
    pathname: "/[project]/messages",
    asPath: mockRouterAsPath,
  }),
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
  }),
}));

vi.mock("../../components/PeriodSelector", () => ({
  usePeriodSelector: () => ({
    period: {
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-31"),
    },
  }),
}));

// Use real filterOutEmptyFilters since we're testing the write path
vi.mock("../../server/filters/registry", () => ({
  availableFilters: {
    "metadata.value": { urlKey: "metadata", name: "Metadata" },
    "metadata.key": { urlKey: "metadata_key", name: "Metadata Key" },
    "events.metrics.value": {
      urlKey: "event_metric_value",
      name: "Event Metric Value",
    },
    "events.metrics.key": { urlKey: "event_metric", name: "Event Metric" },
    "traces.origin": { urlKey: "origin", name: "Origin" },
    "spans.model": { urlKey: "model", name: "Model" },
  },
}));

// ---------------------------------------------------------------------------
// System under test
// ---------------------------------------------------------------------------

import { useFilterParams } from "../useFilterParams";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastPushUrl(): string {
  const lastCall = mockPush.mock.lastCall;
  if (!lastCall) throw new Error("router.push was not called");
  // First arg can be a string (URL) or an object ({ pathname, query })
  return typeof lastCall[0] === "string" ? lastCall[0] : "";
}

function lastPushQuery(): Record<string, unknown> {
  const lastCall = mockPush.mock.lastCall;
  if (!lastCall) throw new Error("router.push was not called");
  if (typeof lastCall[0] === "object" && lastCall[0].query) {
    return lastCall[0].query as Record<string, unknown>;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFilterParams() write operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterQuery = {};
    mockRouterAsPath = "/test-project/messages";
  });

  describe("setFilter()", () => {
    describe("when setting metadata.value filter", () => {
      it("does not strip metadata_key from URL", () => {
        mockRouterQuery = { metadata_key: "env" };
        mockRouterAsPath = "/test-project/messages?metadata_key=env";

        const { result } = renderHook(() => useFilterParams());
        result.current.setFilter("metadata.value", { env: ["prod"] });

        const url = lastPushUrl();
        expect(url).toContain("metadata_key");
        expect(url).toContain("metadata.env=prod");
      });
    });

    describe("when setting event_metric filter", () => {
      it("does not strip event_metric_value from URL", () => {
        mockRouterQuery = { "event_metric_value.click.count": "0,100" };
        mockRouterAsPath =
          "/test-project/messages?event_metric_value.click.count=0,100";

        const { result } = renderHook(() => useFilterParams());
        result.current.setFilter("events.metrics.key", ["count"]);

        const url = lastPushUrl();
        expect(url).toContain("event_metric_value");
      });
    });
  });

  describe("clearFilters()", () => {
    describe("when URL has filters and a search query", () => {
      it("clears both filter params and query param", () => {
        mockRouterQuery = {
          origin: "application",
          model: "gpt-5-mini",
          query: "hello world",
          view: "table",
        };

        const { result } = renderHook(() => useFilterParams());
        result.current.clearFilters();

        const query = lastPushQuery();
        expect(query).not.toHaveProperty("origin");
        expect(query).not.toHaveProperty("model");
        expect(query).not.toHaveProperty("query");
        // Layout params preserved
        expect(query).toHaveProperty("view", "table");
      });
    });
  });

  describe("setFilter() on dynamic route pages", () => {
    describe("when page has [id] route param (e.g. custom graph edit)", () => {
      beforeEach(() => {
        // On /[project]/analytics/custom/[id], router.query includes `id`
        // from the path segment, but the actual URL query string does not
        mockRouterQuery = {
          project: "my-project",
          id: "graph-abc",
          dashboard: "dash-123",
          show_filters: "true",
        };
        mockRouterAsPath =
          "/my-project/analytics/custom/graph-abc?dashboard=dash-123&show_filters=true";
      });

      it("does not leak route params into the query string", () => {
        const { result } = renderHook(() => useFilterParams());
        result.current.setFilter("traces.origin", ["application"]);

        const url = lastPushUrl();
        expect(url).not.toContain("project=");
        expect(url).not.toContain("id=");
      });

      it("preserves existing query params and adds the new filter", () => {
        const { result } = renderHook(() => useFilterParams());
        result.current.setFilter("traces.origin", ["application"]);

        const url = lastPushUrl();
        expect(url).toContain("dashboard=dash-123");
        expect(url).toContain("show_filters=true");
        expect(url).toContain("origin=application");
      });
    });
  });

  describe("setFilters() on dynamic route pages", () => {
    describe("when page has [id] route param", () => {
      beforeEach(() => {
        mockRouterQuery = {
          project: "my-project",
          id: "graph-abc",
          dashboard: "dash-123",
        };
        mockRouterAsPath =
          "/my-project/analytics/custom/graph-abc?dashboard=dash-123";
      });

      it("does not leak route params into the query string", () => {
        const { result } = renderHook(() => useFilterParams());
        result.current.setFilters({
          "traces.origin": ["application"],
          "spans.model": ["gpt-5-mini"],
        } as Parameters<typeof result.current.setFilters>[0]);

        const url = lastPushUrl();
        expect(url).not.toContain("project=");
        expect(url).not.toContain("id=");
      });

      it("preserves existing query params and adds new filters", () => {
        const { result } = renderHook(() => useFilterParams());
        result.current.setFilters({
          "traces.origin": ["application"],
          "spans.model": ["gpt-5-mini"],
        } as Parameters<typeof result.current.setFilters>[0]);

        const url = lastPushUrl();
        expect(url).toContain("dashboard=dash-123");
        expect(url).toContain("origin=application");
        expect(url).toContain("model=gpt-5-mini");
      });
    });
  });

  describe("setNegateFilters()", () => {
    describe("when URL has nested filter params", () => {
      it("preserves params using correct qs options", () => {
        mockRouterQuery = {
          "metadata.env": "prod",
          origin: "application",
        };
        mockRouterAsPath =
          "/test-project/messages?metadata.env=prod&origin=application";

        const { result } = renderHook(() => useFilterParams());
        result.current.setNegateFilters(true);

        const url = lastPushUrl();
        expect(url).toContain("negateFilters=true");
        expect(url).toContain("metadata.env=prod");
        expect(url).toContain("origin=application");
        // Should NOT use bracket notation
        expect(url).not.toContain("[");
      });
    });
  });
});
