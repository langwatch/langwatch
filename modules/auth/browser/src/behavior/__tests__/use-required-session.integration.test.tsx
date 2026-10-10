/**
 * @vitest-environment jsdom
 * Regression: publicRoutes guards unauthenticated pages; jsdom offline tests via online listener
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routeRef } = vi.hoisted(() => ({ routeRef: { current: "/" } }));

vi.mock("../use-route.ts", () => ({
  useRouter: () => ({
    route: routeRef.current,
    pathname: routeRef.current,
    query: {},
  }),
}));

vi.mock("../auth-client.tsx", () => ({
  useSession: ({
    required,
    onUnauthenticated,
  }: {
    required?: boolean;
    onUnauthenticated?: () => void;
  }) => {
    if (required && onUnauthenticated) onUnauthenticated();
    return { data: null, status: "unauthenticated", update: vi.fn() };
  },
}));

import { useRequiredSession } from "../use-required-session.ts";

function Probe() {
  useRequiredSession();
  return null;
}

const onlineListenerCount = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c: unknown[]) => c[0] === "online").length;

describe("useRequiredSession redirect guard", () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    addEventListenerSpy = vi.spyOn(window, "addEventListener");
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
  });

  describe("given an unauthenticated user on an auth-required page", () => {
    describe("when the route is a public auth route", () => {
      /** @scenario "The forgot and reset pages are reachable without signing in" */
      it("does not try to redirect /auth/forgot-password or /auth/reset-password", () => {
        for (const route of ["/auth/forgot-password", "/auth/reset-password"]) {
          addEventListenerSpy.mockClear();
          routeRef.current = route;
          render(<Probe />);
          expect(onlineListenerCount(addEventListenerSpy)).toBe(0);
        }
      });
    });

    describe("when the route is genuinely protected", () => {
      it("reaches the sign-in redirect path", () => {
        routeRef.current = "/some/protected/page";
        render(<Probe />);
        expect(onlineListenerCount(addEventListenerSpy)).toBeGreaterThan(0);
      });
    });
  });
});
