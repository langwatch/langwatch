// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRefreshUIStore } from "../refreshUIStore";

beforeEach(() => {
  vi.useFakeTimers();
  useRefreshUIStore.setState({
    isRefreshing: false,
    isReplacingData: false,
    refreshRequested: false,
    refreshSawFetch: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refreshUIStore", () => {
  describe("given an explicit refresh request", () => {
    describe("when observeFetching(false) arrives before any fetch is seen", () => {
      it("keeps the request alive across the pre-fetch gap", () => {
        useRefreshUIStore.getState().requestRefresh();
        useRefreshUIStore.getState().observeFetching(false);
        expect(useRefreshUIStore.getState().refreshRequested).toBe(true);
      });
    });

    describe("when a fetch is seen and then ends", () => {
      it("clears the request once the fetch settles", () => {
        useRefreshUIStore.getState().requestRefresh();
        useRefreshUIStore.getState().observeFetching(true);
        expect(useRefreshUIStore.getState().refreshRequested).toBe(true);
        useRefreshUIStore.getState().observeFetching(false);
        expect(useRefreshUIStore.getState().refreshRequested).toBe(false);
        expect(useRefreshUIStore.getState().refreshSawFetch).toBe(false);
      });

      it("does not later get cleared again by the safety timer", () => {
        useRefreshUIStore.getState().requestRefresh();
        useRefreshUIStore.getState().observeFetching(true);
        useRefreshUIStore.getState().observeFetching(false);

        // A new request after settling must survive the original timer slot.
        useRefreshUIStore.getState().requestRefresh();
        vi.advanceTimersByTime(14_000);
        expect(useRefreshUIStore.getState().refreshRequested).toBe(true);
      });
    });

    describe("when no fetch is ever observed", () => {
      it("clears the request via the safety timeout", () => {
        useRefreshUIStore.getState().requestRefresh();
        vi.advanceTimersByTime(14_999);
        expect(useRefreshUIStore.getState().refreshRequested).toBe(true);
        vi.advanceTimersByTime(1);
        expect(useRefreshUIStore.getState().refreshRequested).toBe(false);
        expect(useRefreshUIStore.getState().refreshSawFetch).toBe(false);
      });
    });
  });

  describe("given no refresh request", () => {
    describe("when observeFetching is fed background fetch signals", () => {
      it("leaves the request state untouched", () => {
        useRefreshUIStore.getState().observeFetching(true);
        useRefreshUIStore.getState().observeFetching(false);
        expect(useRefreshUIStore.getState().refreshRequested).toBe(false);
        expect(useRefreshUIStore.getState().refreshSawFetch).toBe(false);
      });
    });
  });

  describe("given a pulse", () => {
    describe("when pulse is called", () => {
      it("turns isRefreshing on and self-clears after the duration", () => {
        useRefreshUIStore.getState().pulse(900);
        expect(useRefreshUIStore.getState().isRefreshing).toBe(true);
        vi.advanceTimersByTime(900);
        expect(useRefreshUIStore.getState().isRefreshing).toBe(false);
      });
    });
  });
});
