/**
 * @vitest-environment jsdom
 * The board screen stays mounted across board addresses, so each visit to a missing board gets
 * its own re-read. @see modules/dashboard/specs/board-made-elsewhere.feature
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRereadMissingBoard } from "../behavior/use-reread-missing-board.ts";

type Visit = { dashboardId: string; isMissing: boolean };

describe("useRereadMissingBoard", () => {
  /** @scenario "Coming back to a board still missing reads the list again" */
  it("reads the list again when the reader comes back to a board still missing", async () => {
    const reread = vi.fn(() => Promise.resolve());
    const { result, rerender } = renderHook(
      ({ dashboardId, isMissing }: Visit) =>
        useRereadMissingBoard({ dashboardId, isMissing, reread }),
      { initialProps: { dashboardId: "board-gone", isMissing: true } },
    );
    await waitFor(() => expect(result.current).toBe(false));
    expect(reread).toHaveBeenCalledTimes(1);

    rerender({ dashboardId: "board-listed", isMissing: false });
    rerender({ dashboardId: "board-gone", isMissing: true });

    expect(result.current).toBe(true);
    await waitFor(() => expect(result.current).toBe(false));
    expect(reread).toHaveBeenCalledTimes(2);
  });
});
