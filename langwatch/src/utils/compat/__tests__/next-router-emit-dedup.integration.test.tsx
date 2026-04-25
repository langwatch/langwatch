/**
 * @vitest-environment jsdom
 *
 * Regression test for the PostHog cost spike caused by the Vite migration's
 * next-router compat layer.
 *
 * Before the fix, every mounted useRouter() instance emitted
 * routeChangeComplete on every navigation. With ~120 useRouter() consumers
 * in the app, a single navigation produced ~120 $pageview captures.
 *
 * @see specs/analytics/posthog-cost-control.feature
 */
import React, { useEffect } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";

vi.unmock("~/utils/compat/next-router");
vi.mock("~/utils/compat/next-router", async () =>
  await vi.importActual<object>("~/utils/compat/next-router"),
);

import Router, { useRouter } from "~/utils/compat/next-router";

function ConsumerA() {
  // Component that just calls useRouter — analogous to the ~120 components
  // across the app that read router.query, router.pathname, etc.
  useRouter();
  return null;
}

function ConsumerB() {
  useRouter();
  return null;
}

function ConsumerC() {
  useRouter();
  return null;
}

function Navigator({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);
  return null;
}

function MultiRouterTree({ navTarget }: { navTarget: string | null }) {
  // Render multiple useRouter consumers + a navigator. This mirrors the
  // production tree: dozens of components each subscribe to useRouter,
  // and a navigation event happens once.
  return (
    <Routes>
      <Route
        path="*"
        element={
          <>
            <ConsumerA />
            <ConsumerB />
            <ConsumerC />
            <ConsumerA />
            <ConsumerB />
            <ConsumerC />
            <ConsumerA />
            <ConsumerB />
            <ConsumerC />
            {navTarget !== null ? <Navigator to={navTarget} /> : null}
          </>
        }
      />
    </Routes>
  );
}

describe("next-router compat: routeChangeComplete dedup", () => {
  let onRouteChange: ReturnType<typeof vi.fn<(path: string) => void>>;

  beforeEach(() => {
    onRouteChange = vi.fn<(path: string) => void>();
    Router.events.on("routeChangeComplete", onRouteChange);
  });

  afterEach(() => {
    Router.events.off("routeChangeComplete", onRouteChange);
    cleanup();
  });

  describe("when many components subscribe to useRouter", () => {
    it("emits routeChangeComplete exactly once per navigation", async () => {
      const { rerender } = render(
        <MemoryRouter initialEntries={["/start"]}>
          <MultiRouterTree navTarget={null} />
        </MemoryRouter>,
      );

      onRouteChange.mockClear();

      await act(async () => {
        rerender(
          <MemoryRouter initialEntries={["/start"]}>
            <MultiRouterTree navTarget="/next" />
          </MemoryRouter>,
        );
      });

      // Even with 9 useRouter() consumers mounted, one navigation = one emit.
      // Pre-fix behavior would have emitted at least 9 times.
      expect(onRouteChange).toHaveBeenCalledTimes(1);
      expect(onRouteChange).toHaveBeenCalledWith("/next");
    });

    it("does not re-emit for the same path on remount", async () => {
      const { rerender } = render(
        <MemoryRouter initialEntries={["/same"]}>
          <MultiRouterTree navTarget={null} />
        </MemoryRouter>,
      );
      onRouteChange.mockClear();

      // Re-render the same MemoryRouter with the same path — no new
      // navigation, so no emit even though useRouter effects rerun.
      await act(async () => {
        rerender(
          <MemoryRouter initialEntries={["/same"]}>
            <MultiRouterTree navTarget={null} />
          </MemoryRouter>,
        );
      });

      expect(onRouteChange).not.toHaveBeenCalled();
    });
  });

  describe("when listeners on routerEvents are attached", () => {
    it("invokes each listener exactly once per navigation", async () => {
      const listenerOne = vi.fn<(path: string) => void>();
      const listenerTwo = vi.fn<(path: string) => void>();
      Router.events.on("routeChangeComplete", listenerOne);
      Router.events.on("routeChangeComplete", listenerTwo);

      try {
        const { rerender } = render(
          <MemoryRouter initialEntries={["/a"]}>
            <MultiRouterTree navTarget={null} />
          </MemoryRouter>,
        );
        listenerOne.mockClear();
        listenerTwo.mockClear();

        await act(async () => {
          rerender(
            <MemoryRouter initialEntries={["/a"]}>
              <MultiRouterTree navTarget="/b" />
            </MemoryRouter>,
          );
        });

        expect(listenerOne).toHaveBeenCalledTimes(1);
        expect(listenerTwo).toHaveBeenCalledTimes(1);
      } finally {
        Router.events.off("routeChangeComplete", listenerOne);
        Router.events.off("routeChangeComplete", listenerTwo);
      }
    });
  });
});
