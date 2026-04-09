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

let mockRouterAsPath = "/test-project/messages";
const mockPush = vi.fn().mockResolvedValue(true);

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
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
  return typeof lastCall[0] === "string" ? lastCall[0] : "";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFilterParams() write operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterAsPath = "/test-project/messages";
    window.history.pushState({}, "", "/test-project/messages");
  });

  describe("setFilter()", () => {
    describe("when setting metadata.value filter", () => {
      it("does not strip metadata_key from URL", () => {
        mockRouterAsPath = "/test-project/messages?metadata_key=env";
        window.history.pushState(
          {},
          "",
          "/test-project/messages?metadata_key=env",
        );

        const { result } = renderHook(() => useFilterParams());
        result.current.setFilter("metadata.value", { env: ["prod"] });

        const url = lastPushUrl();
        expect(url).toContain("metadata_key");
        expect(url).toContain("metadata.env=prod");
      });
    });

    describe("when setting event_metric filter", () => {
      it("does not strip event_metric_value from URL", () => {
        mockRouterAsPath =
          "/test-project/messages?event_metric_value.click.count=0,100";
        window.history.pushState(
          {},
          "",
          "/test-project/messages?event_metric_value.click.count=0,100",
        );

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
        mockRouterAsPath =
          "/test-project/messages?origin=application&model=gpt-5-mini&query=hello+world&view=table";
        window.history.pushState(
          {},
          "",
          "/test-project/messages?origin=application&model=gpt-5-mini&query=hello+world&view=table",
        );

        const { result } = renderHook(() => useFilterParams());
        result.current.clearFilters();

        const url = lastPushUrl();
        expect(url).not.toContain("origin=");
        expect(url).not.toContain("model=");
        expect(url).not.toContain("query=");
        // Layout params preserved
        expect(url).toContain("view=table");
      });
    });
  });

  describe("setNegateFilters()", () => {
    describe("when URL has nested filter params", () => {
      it("preserves params using correct qs options", () => {
        mockRouterAsPath =
          "/test-project/messages?metadata.env=prod&origin=application";
        window.history.pushState(
          {},
          "",
          "/test-project/messages?metadata.env=prod&origin=application",
        );

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
