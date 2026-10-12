/**
 * @vitest-environment jsdom
 * @see modules/experiment/specs/experiment-list-page.feature
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePrimaryMetricChoice } from "../use-primary-metric-choice.ts";

const STORAGE_KEY = "experiments-list-primary-metric";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("given two rows that each save a primary-metric pick", () => {
  it("keeps both when the picks come in the same tick", () => {
    const one = renderHook(() => usePrimaryMetricChoice({ projectId: "p", experimentId: "e1" }));
    const two = renderHook(() => usePrimaryMetricChoice({ projectId: "p", experimentId: "e2" }));
    act(() => {
      one.result.current.choose("q");
      two.result.current.choose("r");
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      "p/e1": "q",
      "p/e2": "r",
    });
  });

  it("drops a pick when the default is chosen again", () => {
    const one = renderHook(() => usePrimaryMetricChoice({ projectId: "p", experimentId: "e1" }));
    act(() => one.result.current.choose("q"));
    act(() => one.result.current.choose(undefined));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({});
  });
});

describe("given storage that holds something other than picks", () => {
  const readPick = (stored: string) => {
    localStorage.setItem(STORAGE_KEY, stored);
    return renderHook(() => usePrimaryMetricChoice({ projectId: "p", experimentId: "e1" }));
  };

  /** @scenario Bad browser storage never breaks the page */
  it("treats null, a number, an array and broken JSON as no picks", () => {
    for (const stored of ["null", "5", "[1]", "{broken", '"text"']) {
      const { result, unmount } = readPick(stored);
      expect(result.current.chosenKey).toBeUndefined();
      act(() => result.current.choose("q"));
      expect(result.current.chosenKey).toBe("q");
      unmount();
    }
  });

  /** @scenario Bad browser storage never breaks the page */
  it("ignores values that are not strings but keeps the valid ones", () => {
    const { result } = readPick(JSON.stringify({ "p/e1": 5, "p/e2": "r" }));
    expect(result.current.chosenKey).toBeUndefined();
    act(() => result.current.choose("q"));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      "p/e1": "q",
      "p/e2": "r",
    });
  });
});

describe("given storage that throws", () => {
  /** @scenario Bad browser storage never breaks the page */
  it("reads as no picks when getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() =>
      usePrimaryMetricChoice({ projectId: "p", experimentId: "e1" }),
    );
    expect(result.current.chosenKey).toBeUndefined();
  });

  /** @scenario Bad browser storage never breaks the page */
  it("keeps the pick for the session when setItem throws, and saves again once it works", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() =>
      usePrimaryMetricChoice({ projectId: "p", experimentId: "e1" }),
    );
    act(() => result.current.choose("q"));
    expect(result.current.chosenKey).toBe("q");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    setItem.mockRestore();
    act(() => result.current.choose(undefined));
    expect(result.current.chosenKey).toBeUndefined();
  });
});
