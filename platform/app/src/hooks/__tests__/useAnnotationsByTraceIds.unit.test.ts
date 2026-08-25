/**
 * @vitest-environment jsdom
 *
 * Several surfaces read the same conversation's annotations: the turn list,
 * the header count chip, the rail. Each builds its id array from its own data,
 * so the same set of traces arrives in a different order. The order decides
 * the chunk contents, and the chunk contents are the query key, so an
 * unsorted list makes every consumer fetch its own private copy.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAnnotationsByTraceIds } from "../useAnnotationsByTraceIds";

interface CapturedQuery {
  projectId: string;
  traceIds: string[];
}

const mocks = vi.hoisted(() => ({
  captured: [] as { projectId: string; traceIds: string[] }[],
}));

vi.mock("~/utils/api", () => ({
  api: {
    useQueries: (
      build: (t: {
        annotation: {
          getByTraceIds: (
            input: CapturedQuery,
            options: unknown,
          ) => { data: never[]; isLoading: boolean; isError: boolean };
        };
      }) => unknown[],
    ) =>
      build({
        annotation: {
          getByTraceIds: (input) => {
            mocks.captured.push(input);
            return { data: [], isLoading: false, isError: false };
          },
        },
      }),
  },
}));

const PROJECT_ID = "project-1";

/** The inputs one consumer would send for `traceIds`, in call order. */
function queryInputsFor(traceIds: string[]): CapturedQuery[] {
  mocks.captured = [];
  renderHook(() => useAnnotationsByTraceIds({ projectId: PROJECT_ID, traceIds }));
  return mocks.captured;
}

beforeEach(() => {
  mocks.captured = [];
});

describe("given two consumers reading annotations for the same traces", () => {
  describe("when they list the ids in different orders", () => {
    it("sends identical query inputs", () => {
      const ids = ["trace-c", "trace-a", "trace-b"];
      const shuffled = ["trace-b", "trace-c", "trace-a"];

      expect(queryInputsFor(ids)).toEqual(queryInputsFor(shuffled));
    });
  });

  describe("when the id count spans more than one chunk", () => {
    it("puts the same ids in the same chunk regardless of order", () => {
      // 120 ids across the 50-per-chunk boundary: unsorted, the same traces
      // land in different chunks per consumer, so no two consumers ever share
      // a cached chunk.
      const ids = Array.from(
        { length: 120 },
        (_, i) => `trace-${String(i).padStart(3, "0")}`,
      );
      const reversed = [...ids].reverse();

      const inOrder = queryInputsFor(ids);
      const inReverse = queryInputsFor(reversed);

      expect(inOrder).toHaveLength(3);
      expect(inOrder.map((q) => q.traceIds)).toEqual(inReverse.map((q) => q.traceIds));
    });
  });

  describe("when one of them repeats an id", () => {
    it("asks for that id once", () => {
      const inputs = queryInputsFor(["trace-b", "trace-a", "trace-b"]);

      expect(inputs).toEqual([
        {
          projectId: PROJECT_ID,
          traceIds: ["trace-a", "trace-b"],
          anchor: "trace",
        },
      ]);
    });
  });
});
