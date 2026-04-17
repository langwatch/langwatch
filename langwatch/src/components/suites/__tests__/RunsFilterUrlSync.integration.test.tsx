/**
 * @vitest-environment jsdom
 *
 * Regression test for bug #3191 — applying a filter on the Runs page must not
 * flip the page into the "external set" view with the querystring rendered as
 * the set identifier.
 *
 * Exercises the real compat layer (~/utils/compat/next-router) inside a real
 * react-router MemoryRouter, so the buildUrl/routeParamKeys logic introduced
 * in #3205 is actually under test. No useRouter mocks.
 *
 * @see https://github.com/langwatch/langwatch/issues/3191
 * @see https://github.com/langwatch/langwatch/pull/3205
 */
import React, { useEffect, useRef } from "react";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";

// The global test-setup.ts stubs ~/utils/compat/next-router with an empty
// router. For these tests we need the real compat layer because the bug
// under test lives in its buildUrl / routeParamKeys logic.
vi.unmock("~/utils/compat/next-router");
vi.mock("~/utils/compat/next-router", async () =>
  await vi.importActual<object>("~/utils/compat/next-router"),
);

import {
  ALL_RUNS_ID,
  EXTERNAL_SET_PREFIX,
  useSuiteRouting,
} from "../useSuiteRouting";
import { createRunHistoryStore } from "../useRunHistoryStore";
import { useRouter } from "~/utils/compat/next-router";

type Store = ReturnType<typeof createRunHistoryStore>;

/**
 * Mirrors RunHistoryPanel's syncToUrl-on-filter-change pattern without
 * pulling in its heavy dependencies (tRPC hooks, Chakra, etc).
 */
function Harness({ store }: { store: Store }) {
  const { selectedSuiteSlug } = useSuiteRouting();
  const router = useRouter();
  const location = useLocation();

  const syncToUrl = store((s) => s.syncToUrl);
  const filters = store((s) => s.filters);
  const groupBy = store((s) => s.groupBy);

  const prevFilters = useRef(filters);
  const prevGroupBy = useRef(groupBy);

  useEffect(() => {
    if (
      prevFilters.current !== filters ||
      prevGroupBy.current !== groupBy
    ) {
      prevFilters.current = filters;
      prevGroupBy.current = groupBy;
      syncToUrl(router);
    }
  }, [filters, groupBy, syncToUrl, router]);

  return (
    <div>
      <span data-testid="selection">{selectedSuiteSlug ?? "loading"}</span>
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
    </div>
  );
}

function renderHarness(initialUrl: string) {
  const store = createRunHistoryStore();
  render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route
          path="/:project/simulations/*"
          element={<Harness store={store} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return store;
}

afterEach(() => {
  cleanup();
});

describe("given the Runs page at /my-project/simulations (All Runs)", () => {
  describe("when a passFailStatus filter is applied", () => {
    it("keeps selection as all-runs and puts filter in the querystring", async () => {
      const store = renderHarness("/my-project/simulations");

      expect(screen.getByTestId("selection").textContent).toBe(ALL_RUNS_ID);
      expect(screen.getByTestId("pathname").textContent).toBe(
        "/my-project/simulations",
      );

      await act(async () => {
        store.getState().setFilter("passFailStatus", "fail");
      });

      await waitFor(() => {
        expect(screen.getByTestId("search").textContent).toContain(
          "passFailStatus=fail",
        );
      });

      expect(screen.getByTestId("selection").textContent).toBe(ALL_RUNS_ID);
      expect(screen.getByTestId("pathname").textContent).toBe(
        "/my-project/simulations",
      );
      expect(screen.getByTestId("selection").textContent).not.toContain(
        EXTERNAL_SET_PREFIX,
      );
    });
  });

  describe("when a scenarioId filter is applied", () => {
    it("keeps selection as all-runs and puts filter in the querystring", async () => {
      const store = renderHarness("/my-project/simulations");

      expect(screen.getByTestId("selection").textContent).toBe(ALL_RUNS_ID);

      await act(async () => {
        store.getState().setFilter("scenarioId", "scen_1");
      });

      await waitFor(() => {
        expect(screen.getByTestId("search").textContent).toContain(
          "scenarioId=scen_1",
        );
      });

      expect(screen.getByTestId("selection").textContent).toBe(ALL_RUNS_ID);
      expect(screen.getByTestId("pathname").textContent).toBe(
        "/my-project/simulations",
      );
    });
  });

  describe("when a groupBy is applied", () => {
    it("keeps selection as all-runs and puts groupBy in the querystring", async () => {
      const store = renderHarness("/my-project/simulations");

      expect(screen.getByTestId("selection").textContent).toBe(ALL_RUNS_ID);

      await act(async () => {
        store.getState().setGroupBy("scenario");
      });

      await waitFor(() => {
        expect(screen.getByTestId("search").textContent).toContain(
          "groupBy=scenario",
        );
      });

      expect(screen.getByTestId("selection").textContent).toBe(ALL_RUNS_ID);
      expect(screen.getByTestId("pathname").textContent).toBe(
        "/my-project/simulations",
      );
    });
  });
});

describe("given the Runs page at /my-project/simulations/run-plans/critical-path (suite detail)", () => {
  describe("when a filter is applied", () => {
    it("keeps selection as critical-path and preserves the suite path", async () => {
      const store = renderHarness(
        "/my-project/simulations/run-plans/critical-path",
      );

      expect(screen.getByTestId("selection").textContent).toBe("critical-path");

      await act(async () => {
        store.getState().setFilter("passFailStatus", "pass");
      });

      await waitFor(() => {
        expect(screen.getByTestId("search").textContent).toContain(
          "passFailStatus=pass",
        );
      });

      expect(screen.getByTestId("selection").textContent).toBe("critical-path");
      expect(screen.getByTestId("pathname").textContent).toBe(
        "/my-project/simulations/run-plans/critical-path",
      );
    });
  });
});

describe("given the Runs page at /my-project/simulations/python-examples (external set)", () => {
  describe("when a filter is applied", () => {
    it("keeps selection as external:python-examples and preserves the set path", async () => {
      const store = renderHarness(
        "/my-project/simulations/python-examples",
      );

      expect(screen.getByTestId("selection").textContent).toBe(
        `${EXTERNAL_SET_PREFIX}python-examples`,
      );

      await act(async () => {
        store.getState().setFilter("scenarioId", "scen_1");
      });

      await waitFor(() => {
        expect(screen.getByTestId("search").textContent).toContain(
          "scenarioId=scen_1",
        );
      });

      expect(screen.getByTestId("selection").textContent).toBe(
        `${EXTERNAL_SET_PREFIX}python-examples`,
      );
      expect(screen.getByTestId("pathname").textContent).toBe(
        "/my-project/simulations/python-examples",
      );
      // Bug symptom: selection would become "external:?scenarioId=scen_1" or
      // similar if the compat layer leaks the querystring into path segments.
      expect(screen.getByTestId("selection").textContent).not.toContain("?");
      expect(screen.getByTestId("selection").textContent).not.toContain(
        "scen_1",
      );
    });
  });
});
