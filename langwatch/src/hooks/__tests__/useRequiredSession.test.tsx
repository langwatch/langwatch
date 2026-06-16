/**
 * @vitest-environment jsdom
 *
 * Guards the public-route allowlist that keeps the unauthenticated auth pages
 * (forgot/reset password) reachable. Regression: those routes were missing
 * from `publicRoutes`, so the global session guard bounced visitors to
 * /auth/signin?callbackUrl=... before they could request a reset. The
 * page-render tests could not catch it because they mount the component
 * directly, bypassing the router-level guard.
 *
 * jsdom locks `window.location.href`, so rather than observe the online
 * redirect we drive the guard through its OFFLINE branch (it registers an
 * `online` listener instead of navigating). A public route returns before
 * either branch, so no `online` listener is registered; a protected route
 * reaches the redirect and registers one.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routeRef } = vi.hoisted(() => ({ routeRef: { current: "/" } }));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ route: routeRef.current }),
}));

vi.mock("~/utils/auth-client", () => ({
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

import { useRequiredSession } from "../useRequiredSession";

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

  describe("when an unauthenticated user lands on a public auth route", () => {
    /** @scenario The forgot and reset pages are reachable without signing in */
    it("does not try to redirect /auth/forgot-password or /auth/reset-password", () => {
      for (const route of ["/auth/forgot-password", "/auth/reset-password"]) {
        addEventListenerSpy.mockClear();
        routeRef.current = route;
        render(<Probe />);
        expect(onlineListenerCount(addEventListenerSpy)).toBe(0);
      }
    });
  });

  describe("when an unauthenticated user lands on a genuinely protected route", () => {
    it("reaches the sign-in redirect path", () => {
      routeRef.current = "/some/protected/page";
      render(<Probe />);
      expect(onlineListenerCount(addEventListenerSpy)).toBeGreaterThan(0);
    });
  });
});
