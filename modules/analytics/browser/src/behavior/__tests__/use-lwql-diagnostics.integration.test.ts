/**
 * @vitest-environment jsdom
 * @see modules/analytics/specs/analytics-lwql-editor.feature
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock("../analytics-api.ts", () => ({
  analyticsApi: { analytics: { lwql: { validate: { useQuery: useQueryMock } } } },
}));

import { useLwqlDiagnostics } from "../use-lwql-diagnostics.ts";

const REFUSAL = {
  code: "TABLE_NOT_ALLOWED",
  clause: "from",
  message: "The table analytics.virtual_keys is not available to you.",
  hint: "Read a table listed in the schema.",
  at: { line: 1, column: 15 },
};
const REFUSED_SQL = "SELECT * FROM analytics.virtual_keys";

/** The answers the server has given so far, by the statement each was asked about. */
function answering(answers: Record<string, unknown>) {
  useQueryMock.mockImplementation((input: { sql: string }) => ({ data: answers[input.sql] }));
}

describe("useLwqlDiagnostics()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useQueryMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  describe("given the server refused the statement at a position", () => {
    describe("when typing settles", () => {
      /** @scenario "A refusal is marked at the server's position" */
      it("draws the marker at that line and column", () => {
        answering({ [REFUSED_SQL]: { violations: [REFUSAL] } });
        const { result } = renderHook(() =>
          useLwqlDiagnostics({ projectId: "project_1", sql: REFUSED_SQL }),
        );
        act(() => void vi.advanceTimersByTime(600));

        expect(result.current).toEqual([
          { message: REFUSAL.message, severity: "error", line: 1, column: 15 },
        ]);
        expect(useQueryMock).toHaveBeenLastCalledWith(
          { projectId: "project_1", sql: REFUSED_SQL },
          expect.objectContaining({ retry: false }),
        );
      });
    });
  });

  describe("given the statement was edited after it was refused", () => {
    describe("when the answer for the earlier text is all there is", () => {
      /** @scenario "A superseded validation answer is dropped" */
      it("draws nothing for the new text", () => {
        answering({ [REFUSED_SQL]: { violations: [REFUSAL] } });
        const { result, rerender } = renderHook(
          ({ sql }) => useLwqlDiagnostics({ projectId: "project_1", sql }),
          { initialProps: { sql: REFUSED_SQL } },
        );
        act(() => void vi.advanceTimersByTime(600));
        expect(result.current).toHaveLength(1);

        rerender({ sql: "SELECT 1" });
        expect(result.current).toEqual([]);
        act(() => void vi.advanceTimersByTime(600));
        expect(result.current).toEqual([]);
      });
    });
  });

  describe("given the validation failed", () => {
    describe("when typing settles", () => {
      /** @scenario "A failed validation clears the markers" */
      it("draws no markers", () => {
        answering({ [REFUSED_SQL]: { violations: [REFUSAL] } });
        const { result, rerender } = renderHook(
          ({ sql }) => useLwqlDiagnostics({ projectId: "project_1", sql }),
          { initialProps: { sql: REFUSED_SQL } },
        );
        act(() => void vi.advanceTimersByTime(600));
        expect(result.current).toHaveLength(1);

        useQueryMock.mockReturnValue({ data: undefined, isError: true });
        rerender({ sql: `${REFUSED_SQL} LIMIT 5` });
        act(() => void vi.advanceTimersByTime(600));

        expect(result.current).toEqual([]);
      });
    });
  });
});
