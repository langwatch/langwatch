// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTraceSpanTree } from "../useTraceSpanTree";

type SpanTreeInput = {
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
};

type CapturedQueryOptions = {
  queryKey: unknown;
  queryFn: unknown;
  enabled: boolean;
};

const capturedQueryOptions: CapturedQueryOptions[] = [];
let previewTraceId = false;

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: CapturedQueryOptions) => {
    capturedQueryOptions.push(options);
    return { data: [], isLoading: false };
  },
  useQueryClient: () => ({}),
}));

vi.mock("~/utils/api", () => ({
  api: { useUtils: () => ({}) },
}));

const QUERY_FN_MARKER = () => Promise.resolve([]);

vi.mock("../spanTreePagedQuery", () => ({
  spanTreeQueryKey: (input: SpanTreeInput) => ["spanTree", input],
  spanTreeQueryFn: ({ input }: { input: SpanTreeInput }) => {
    void input;
    return QUERY_FN_MARKER;
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1" } }),
}));

vi.mock("../../onboarding/data/samplePreviewTraces", () => ({
  isPreviewTraceId: () => previewTraceId,
}));

const lastOptions = (): CapturedQueryOptions => {
  const options = capturedQueryOptions[capturedQueryOptions.length - 1];
  if (!options) {
    throw new Error("no query options were captured");
  }
  return options;
};

describe("useTraceSpanTree", () => {
  beforeEach(() => {
    capturedQueryOptions.length = 0;
    previewTraceId = false;
  });

  describe("when the row's trace timestamp is supplied", () => {
    it("keys and fetches the shared paged span-tree entry, forwarding the occurredAtMs partition hint", () => {
      renderHook(() => useTraceSpanTree("trace-123", 1_700_000_000_000));

      expect(lastOptions().queryKey).toEqual([
        "spanTree",
        {
          projectId: "p1",
          traceId: "trace-123",
          occurredAtMs: 1_700_000_000_000,
        },
      ]);
      expect(lastOptions().queryFn).toBe(QUERY_FN_MARKER);
      expect(lastOptions().enabled).toBe(true);
    });
  });

  describe("when no trace timestamp is supplied", () => {
    it("leaves occurredAtMs undefined (unconstrained scan fallback)", () => {
      renderHook(() => useTraceSpanTree("trace-123"));

      expect(lastOptions().queryKey).toEqual([
        "spanTree",
        {
          projectId: "p1",
          traceId: "trace-123",
          occurredAtMs: undefined,
        },
      ]);
    });
  });

  describe("when the traceId is a preview-mode synthetic", () => {
    it("disables the fetch so the seeded cache entry is not clobbered", () => {
      previewTraceId = true;

      renderHook(() => useTraceSpanTree("preview-trace"));

      expect(lastOptions().enabled).toBe(false);
    });
  });
});
