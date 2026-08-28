/**
 * @vitest-environment jsdom
 *
 * `useTraceListAnnotations` lays each row's reviews over it from their own
 * read. Annotations live in another store than the rest of a row, so when the
 * list asks for them, and what a row shows before the answer arrives, is part
 * of the behaviour rather than an implementation detail.
 *
 * See specs/traces-v2/trace-list-annotations-column.feature.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  useAnnotationsByTraceIds: vi.fn(),
  projectId: { value: "proj-1" as string | undefined },
  permissions: { annotationsView: true },
  view: { columnOrder: ["time", "trace", "annotations"] },
}));

vi.mock("~/hooks/useAnnotationsByTraceIds", () => ({
  useAnnotationsByTraceIds: harness.useAnnotationsByTraceIds,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: harness.projectId.value ? { id: harness.projectId.value } : undefined,
    hasPermission: (permission: string) =>
      permission === "annotations:view" ? harness.permissions.annotationsView : true,
  }),
}));

vi.mock("@langwatch/trace-web/view.store", () => ({
  useViewStore: (selector: (s: unknown) => unknown) => selector(harness.view),
}));

import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import type { TraceListItem } from "../../types/trace";
import { NO_TRACE_EVENTS } from "../../types/trace";
import { useTraceListAnnotations } from "../useTraceListAnnotations";

/** A row with nothing said about it, so only what the hook merges shows up. */
function row(traceId: string): TraceListItem {
  return {
    traceId,
    timestamp: 0,
    name: traceId,
    serviceName: "svc",
    durationMs: 1,
    totalCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    evaluations: [],
    events: NO_TRACE_EVENTS,
  } as unknown as TraceListItem;
}

/** One stored review of a trace, with only the fields a case cares about. */
function annotation({
  traceId,
  comment = null,
}: {
  traceId: string;
  comment?: string | null;
}): AnnotationByTrace {
  return { id: `a-${traceId}`, traceId, comment } as AnnotationByTrace;
}

/** What the hook asked for on its most recent render. */
const lastArgs = () => harness.useAnnotationsByTraceIds.mock.calls.at(-1)?.[0];

function answerWith({
  data = [],
  isLoading = false,
  isError = false,
}: {
  data?: AnnotationByTrace[];
  isLoading?: boolean;
  isError?: boolean;
}) {
  harness.useAnnotationsByTraceIds.mockImplementation(() => ({
    data,
    isLoading,
    isError,
  }));
}

beforeEach(() => {
  harness.useAnnotationsByTraceIds.mockReset();
  answerWith({});
  harness.projectId.value = "proj-1";
  harness.permissions.annotationsView = true;
  harness.view = { columnOrder: ["time", "trace", "annotations"] };
});

describe("useTraceListAnnotations", () => {
  describe("given the Annotations column is visible", () => {
    describe("when a page of traces is on screen", () => {
      /** @scenario "Annotations are read for the traces currently on screen" */
      it("asks for the page's traces, and for everything said about them", () => {
        renderHook(() => useTraceListAnnotations({ rows: [row("t1"), row("t2")] }));

        expect(lastArgs()).toEqual(
          expect.objectContaining({
            projectId: "proj-1",
            traceIds: ["t1", "t2"],
            enabled: true,
            // A comment on one span is still something said about the trace.
            anchor: "all",
          }),
        );
      });

      /** @scenario "A new annotation reaches the row without a reload" */
      it("reads the shared feed, which every annotation write invalidates", () => {
        renderHook(() => useTraceListAnnotations({ rows: [row("t1")] }));

        expect(harness.useAnnotationsByTraceIds).toHaveBeenCalled();
      });
    });

    describe("when the annotations have arrived", () => {
      it("lays each trace's reviews over its own row", () => {
        answerWith({
          data: [
            annotation({ traceId: "t1", comment: "too terse" }),
            annotation({ traceId: "t1", comment: "reads well" }),
            annotation({ traceId: "other-page", comment: "elsewhere" }),
          ],
        });

        const { result } = renderHook(() =>
          useTraceListAnnotations({ rows: [row("t1"), row("t2")] }),
        );

        expect(result.current[0]?.annotations).toHaveLength(2);
        // A trace the read said nothing about has nothing said about it.
        expect(result.current[1]?.annotations).toEqual([]);
      });
    });

    describe("when the annotations have not arrived yet", () => {
      /** @scenario "The list still renders while annotations are in flight" */
      it("marks rows pending, without claiming nobody reviewed them", () => {
        answerWith({ isLoading: true });

        const { result } = renderHook(() =>
          useTraceListAnnotations({ rows: [row("t1")] }),
        );

        expect(result.current[0]?.annotationsLoading).toBe(true);
        expect(result.current[0]?.annotations).toEqual([]);
      });
    });

    describe("when the annotations could not be read", () => {
      /** @scenario "A failed annotations read says so rather than reading as empty" */
      it("marks the rows unavailable and leaves the rest of them intact", () => {
        answerWith({ isError: true });

        const { result } = renderHook(() =>
          useTraceListAnnotations({ rows: [row("t1"), row("t2")] }),
        );

        expect(result.current).toHaveLength(2);
        expect(result.current[0]?.traceId).toBe("t1");
        expect(result.current[0]?.annotationsUnavailable).toBe(true);
        expect(result.current[0]?.annotationsLoading).toBeFalsy();
      });
    });
  });

  describe("given nothing on screen reads a row's annotations", () => {
    describe("when a page of traces is on screen", () => {
      /** @scenario "Hiding the Annotations column costs nothing" */
      it("makes no request and leaves the rows untouched", () => {
        harness.view = { columnOrder: ["time", "trace"] };
        const rows = [row("t1")];

        const { result } = renderHook(() => useTraceListAnnotations({ rows }));

        expect(lastArgs()).toEqual(expect.objectContaining({ enabled: false }));
        expect(result.current).toBe(rows);
      });
    });
  });

  describe("given the Annotations column was hidden", () => {
    describe("when the user enables it", () => {
      /** @scenario "Enabling the Annotations column fills it in place" */
      it("starts asking about the traces already on screen", () => {
        harness.view = { columnOrder: ["time", "trace"] };
        const rows = [row("t1")];
        const { rerender } = renderHook(() => useTraceListAnnotations({ rows }));
        expect(lastArgs()).toEqual(expect.objectContaining({ enabled: false }));

        harness.view = { columnOrder: ["time", "trace", "annotations"] };
        rerender();

        expect(lastArgs()).toEqual(
          expect.objectContaining({ enabled: true, traceIds: ["t1"] }),
        );
      });
    });
  });

  describe("given the page has no traces on it", () => {
    describe("when the Annotations column is visible", () => {
      /** @scenario "A page with no traces on it looks nothing up" */
      it("makes no request", () => {
        renderHook(() => useTraceListAnnotations({ rows: [] }));

        expect(lastArgs()).toEqual(expect.objectContaining({ enabled: false }));
      });
    });
  });

  describe("given the rows are onboarding sample traces", () => {
    describe("when the Annotations column is visible", () => {
      /** @scenario "Onboarding sample traces are not looked up" */
      it("looks nothing up for them", () => {
        const { result } = renderHook(() =>
          useTraceListAnnotations({
            rows: [row("sample-1")],
            isSamplePreview: true,
          }),
        );

        expect(lastArgs()).toEqual(expect.objectContaining({ enabled: false }));
        expect(result.current[0]?.annotations).toBeUndefined();
      });
    });
  });

  describe("given a reader who may not see annotations", () => {
    describe("when the Annotations column is visible to them anyway", () => {
      /** @scenario "A reader who may not see annotations never asks for them" */
      it("looks nothing up and says the column cannot answer", () => {
        harness.permissions.annotationsView = false;

        const { result } = renderHook(() =>
          useTraceListAnnotations({ rows: [row("t1")] }),
        );

        expect(lastArgs()).toEqual(expect.objectContaining({ enabled: false }));
        expect(result.current[0]?.annotationsUnavailable).toBe(true);
        expect(result.current[0]?.annotations).toEqual([]);
      });
    });
  });
});
