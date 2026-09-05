import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserUiDocumentTitle,
  UiCapabilityContextProvider,
  UiNavigationPort,
  UiRoutePort,
  UNAVAILABLE_UI_FEEDBACK,
  UNAVAILABLE_UI_SESSION,
  type UiCapabilities,
  type UiRouteReadingValues,
} from "../capabilities";
import { useRouter } from "../use-router";

const navigated: { to: string; replace: boolean }[] = [];
const queries: { next: Record<string, string | undefined>; replace: boolean }[] = [];
const backs = vi.fn<() => void>();

class RecordingNavigation extends UiNavigationPort {
  navigate(to: string): void {
    navigated.push({ to, replace: false });
  }

  replace(to: string): void {
    navigated.push({ to, replace: true });
  }

  back(): void {
    backs();
  }
}

class RecordingRoute extends UiRoutePort {
  constructor(private readonly values: UiRouteReadingValues) {
    super();
  }

  reading(): UiRouteReadingValues {
    return this.values;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    queries.push({ next: { ...next }, replace: options?.replace ?? false });
  }
}

function capabilities(values: UiRouteReadingValues): UiCapabilities {
  return {
    documentTitle: BrowserUiDocumentTitle.create(),
    feedback: UNAVAILABLE_UI_FEEDBACK,
    navigation: new RecordingNavigation(),
    route: new RecordingRoute(values),
    session: UNAVAILABLE_UI_SESSION,
  };
}

function mounted(values: UiRouteReadingValues) {
  return ({ children }: { children: ReactNode }) => (
    <UiCapabilityContextProvider value={capabilities(values)}>
      {children}
    </UiCapabilityContextProvider>
  );
}

describe("useRouter", () => {
  describe("when capabilities are mounted above it", () => {
    it("merges the path parameters over the query string", () => {
      const { result } = renderHook(() => useRouter(), {
        wrapper: mounted({
          params: { project: "checkout", id: "from-params" },
          query: { id: "from-query", tab: "runs" },
          pathname: "/checkout/traces",
        }),
      });

      expect(result.current.query).toEqual({
        project: "checkout",
        id: "from-params",
        tab: "runs",
      });
      expect(result.current.params).toEqual({ project: "checkout", id: "from-params" });
      expect(result.current.search).toEqual({ id: "from-query", tab: "runs" });
    });

    it("reads the address the reader is on", () => {
      const { result } = renderHook(() => useRouter(), {
        wrapper: mounted({ params: {}, query: { tab: "runs" }, pathname: "/checkout/traces" }),
      });

      expect(result.current.pathname).toBe("/checkout/traces");
      expect(result.current.route).toBe("/checkout/traces");
      expect(result.current.asPath).toBe("/checkout/traces?tab=runs");
      expect(result.current.isReady).toBe(true);
    });

    it("navigates for an address with a path", async () => {
      const { result } = renderHook(() => useRouter(), {
        wrapper: mounted({ params: {}, query: {}, pathname: "/checkout/traces" }),
      });

      await result.current.push("/checkout/simulations");
      await result.current.replace("/checkout/datasets");

      expect(navigated).toContainEqual({ to: "/checkout/simulations", replace: false });
      expect(navigated).toContainEqual({ to: "/checkout/datasets", replace: true });
    });

    it("writes the query rather than navigating for a query-only address", async () => {
      const { result } = renderHook(() => useRouter(), {
        wrapper: mounted({ params: {}, query: {}, pathname: "/checkout/traces" }),
      });

      await result.current.push("?tab=spans");
      await result.current.push({ pathname: "/checkout/traces", query: { tab: "logs" } });

      expect(queries).toContainEqual({ next: { tab: "spans" }, replace: false });
      expect(queries).toContainEqual({ next: { tab: "logs" }, replace: false });
    });

    it("goes back through the navigation port", () => {
      const { result } = renderHook(() => useRouter(), {
        wrapper: mounted({ params: {}, query: {}, pathname: "/checkout/traces" }),
      });

      result.current.back();

      expect(backs).toHaveBeenCalled();
    });
  });

  describe("when no capabilities are mounted", () => {
    it("answers an empty address instead of throwing", async () => {
      const { result } = renderHook(() => useRouter());

      expect(result.current.isReady).toBe(false);
      expect(result.current.query).toEqual({});
      expect(result.current.pathname).toBe("");
      await expect(result.current.push("/checkout/traces")).resolves.toBe(false);
    });
  });
});
