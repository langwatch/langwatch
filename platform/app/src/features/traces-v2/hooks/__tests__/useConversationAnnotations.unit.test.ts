// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { useConversationAnnotations } from "../useConversationAnnotations";

const annotations = vi.hoisted(() => ({
  rows: [] as unknown[],
  askedFor: [] as unknown[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
    hasPermission: () => true,
  }),
}));

// Stands in for the retention the real hook asks for: whatever it last read is
// handed back while the next set of turns is still in flight.
vi.mock("~/hooks/useAnnotationsByTraceIds", () => ({
  useAnnotationsByTraceIds: (params: unknown) => {
    annotations.askedFor.push(params);
    return {
      data: annotations.rows,
      isLoading: false,
      isError: false,
    };
  },
}));

const annotation = (traceId: string): AnnotationByTrace =>
  ({
    id: `annotation-on-${traceId}`,
    traceId,
    anchorKind: null,
  }) as AnnotationByTrace;

const anchoredAnnotation = ({
  traceId,
  spanId,
}: {
  traceId: string;
  spanId: string;
}): AnnotationByTrace =>
  ({
    id: `annotation-on-${spanId}`,
    traceId,
    anchorKind: "span",
    anchorId: spanId,
    anchorPath: null,
  }) as AnnotationByTrace;

describe("useConversationAnnotations", () => {
  beforeEach(() => {
    annotations.rows = [];
    annotations.askedFor = [];
  });

  describe("given the annotations of the conversation being read", () => {
    it("groups them under the turn each was left on", () => {
      annotations.rows = [annotation("trace-1"), annotation("trace-2")];

      const { result } = renderHook(() =>
        useConversationAnnotations(["trace-1", "trace-2"]),
      );

      expect(result.current.all).toHaveLength(2);
      expect(result.current.hasAny).toBe(true);
      expect(result.current.byTrace.get("trace-1")).toHaveLength(1);
      expect(result.current.byTrace.get("trace-2")).toHaveLength(1);
    });
  });

  describe("given a turn commented on as a whole and on two of its spans", () => {
    beforeEach(() => {
      annotations.rows = [
        annotation("trace-1"),
        anchoredAnnotation({ traceId: "trace-1", spanId: "span-1" }),
        anchoredAnnotation({ traceId: "trace-1", spanId: "span-2" }),
      ];
    });

    /** @scenario "A turn's annotation count counts what was said about the turn" */
    it("holds only what was said about the turn under the turn", () => {
      const { result } = renderHook(() => useConversationAnnotations(["trace-1"]));

      expect(result.current.byTrace.get("trace-1")).toHaveLength(1);
    });

    it("holds what was said about its parts apart from it", () => {
      const { result } = renderHook(() => useConversationAnnotations(["trace-1"]));

      expect(result.current.byAnchor.get("trace-1")?.map((a) => a.anchorId)).toEqual([
        "span-1",
        "span-2",
      ]);
    });

    it("reads every comment on the turns rather than only the ones about them", () => {
      renderHook(() => useConversationAnnotations(["trace-1"]));

      expect(annotations.askedFor[0]).toMatchObject({ anchor: "all" });
    });
  });

  describe("given the previous conversation's annotations are still held", () => {
    it("counts none of them against the conversation now open", () => {
      annotations.rows = [annotation("trace-1"), annotation("trace-2")];

      const { result } = renderHook(() => useConversationAnnotations(["trace-9"]));

      expect(result.current.all).toEqual([]);
      expect(result.current.hasAny).toBe(false);
      expect(result.current.byTrace.size).toBe(0);
    });
  });
});
