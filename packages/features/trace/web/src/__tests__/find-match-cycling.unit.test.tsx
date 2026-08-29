// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFindMatchCycling } from "../index";

describe("trace find match cycling", () => {
  it("wraps next and previous navigation and resets when matches change", () => {
    const { result, rerender } = renderHook(({ matches }) => useFindMatchCycling(matches), {
      initialProps: { matches: ["trace-1", "trace-2"] },
    });

    expect(result.current.currentId).toBe("trace-1");
    act(() => result.current.next());
    expect(result.current.currentId).toBe("trace-2");
    act(() => result.current.next());
    expect(result.current.currentId).toBe("trace-1");
    act(() => result.current.previous());
    expect(result.current.currentId).toBe("trace-2");

    rerender({ matches: ["trace-3"] });
    expect(result.current.currentId).toBe("trace-3");
  });

  it("does not manufacture a current id for an empty result", () => {
    const { result } = renderHook(() => useFindMatchCycling([]));

    act(() => {
      result.current.next();
      result.current.previous();
    });

    expect(result.current.currentId).toBeNull();
    expect(result.current.currentIndex).toBe(0);
  });
});
