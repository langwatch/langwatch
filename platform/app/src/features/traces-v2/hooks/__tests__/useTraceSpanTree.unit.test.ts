// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTraceSpanTree } from "../useTraceSpanTree";

type SpanTreeInput = {
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
};

const capturedInputs: SpanTreeInput[] = [];

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      spanTree: {
        useQuery: (input: SpanTreeInput) => {
          capturedInputs.push(input);
          return { data: [], isLoading: false };
        },
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1" } }),
}));

vi.mock("../../onboarding/data/samplePreviewTraces", () => ({
  isPreviewTraceId: () => false,
}));

const lastInput = (): SpanTreeInput => {
  const input = capturedInputs[capturedInputs.length - 1];
  if (!input) {
    throw new Error("no query input was captured");
  }
  return input;
};

describe("useTraceSpanTree", () => {
  beforeEach(() => {
    capturedInputs.length = 0;
  });

  describe("when the row's trace timestamp is supplied", () => {
    it("forwards it as the occurredAtMs partition hint", () => {
      renderHook(() => useTraceSpanTree("trace-123", 1_700_000_000_000));

      expect(lastInput()).toMatchObject({
        traceId: "trace-123",
        occurredAtMs: 1_700_000_000_000,
      });
    });
  });

  describe("when no trace timestamp is supplied", () => {
    it("leaves occurredAtMs undefined (unconstrained scan fallback)", () => {
      renderHook(() => useTraceSpanTree("trace-123"));

      expect(lastInput().occurredAtMs).toBeUndefined();
    });
  });
});
