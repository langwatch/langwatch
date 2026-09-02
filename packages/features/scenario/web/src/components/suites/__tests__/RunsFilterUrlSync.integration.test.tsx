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

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The empty states carry the Setup via Agent menu, whose langy hooks need
// app context these tests do not build; the control has its own tests.
vi.mock("@langwatch/trace-web/components/SetupWithAgentButton", () => ({
  SetupWithAgentButton: () => null,
}));

import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { ScenarioHostPort, ScenarioHostProvider } from "../../../model/scenario-host";

// The global test-setup.ts stubs ~/utils/compat/next-router with an empty
// router. For these tests we need the real compat layer because the bug
// under test lives in its buildUrl / routeParamKeys logic.
vi.unmock("../../../behavior/next-router");
vi.mock(
  "../../../behavior/next-router",
  async () => await vi.importActual<object>("../../../behavior/next-router"),
);

import { useRouter } from "../../../behavior/next-router";
import { createRunHistoryStore } from "@langwatch/suite-web";
import { ALL_RUNS_ID, EXTERNAL_SET_PREFIX, useSuiteRouting } from "../useSuiteRouting";

type Store = ReturnType<typeof createRunHistoryStore>;

/**
 * The host the compat router reads, wired to the MemoryRouter this test drives.
 *
 * The shim answers the ADDRESS off `ScenarioHostPort` rather than off
 * react-router, so exercising "the real compat layer" now means mounting a
 * real host over a real router rather than mounting the router alone. The
 * writes go straight back to `useNavigate`, which is what keeps
 * `buildUrl`/`routeParamKeys` — the logic the bug lived in — under test.
 */
function TestScenarioHost({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  const host = useMemo(() => {
    const query: Record<string, string | undefined> = {};
    for (const [key, value] of new URLSearchParams(location.search).entries()) {
      query[key] = value;
    }
    const reading = {
      params: params as Record<string, string | string[] | undefined>,
      query,
      pathname: location.pathname,
    };
    return new (class extends ScenarioHostPort {
      project() {
        return { id: "proj-1", slug: "my-project", name: "My project" };
      }
      organization() {
        return void 0;
      }
      team() {
        return void 0;
      }
      organizationRole() {
        return void 0;
      }
      currentUser() {
        return void 0;
      }
      hasPermission() {
        return true;
      }
      isLoading() {
        return false;
      }
      route() {
        return reading;
      }
      setQuery() {
        // The page under test writes whole addresses, never one key.
      }
      navigate(to: string, options?: { replace?: boolean }) {
        void navigate(to, { replace: options?.replace ?? false });
      }
      succeeded() {
        // Nothing here reports a success.
      }
      failed() {
        // Nothing here reports a failure.
      }
    })();
  }, [location.pathname, location.search, params, navigate]);

  return <ScenarioHostProvider value={host}>{children}</ScenarioHostProvider>;
}

/**
 * Mirrors the syncToUrl-on-filter-change effect in RunHistoryPanel
 * (src/components/suites/RunHistoryPanel.tsx, look for the prevFilters/
 * prevGroupBy useRef + useEffect). Must be kept in sync with that component.
 * Extracting into a shared hook would be cleaner, but the effect is small
 * enough that duplication is cheaper than the indirection for now.
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
    if (prevFilters.current !== filters || prevGroupBy.current !== groupBy) {
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
          element={
            <TestScenarioHost>
              <Harness store={store} />
            </TestScenarioHost>
          }
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
      expect(screen.getByTestId("pathname").textContent).toBe("/my-project/simulations");

      await act(async () => {
        store.getState().setFilter("passFailStatus", "fail");
      });

      await waitFor(() => {
        expect(screen.getByTestId("search").textContent).toContain("passFailStatus=fail");
      });

      expect(screen.getByTestId("selection").textContent).toBe(ALL_RUNS_ID);
      expect(screen.getByTestId("pathname").textContent).toBe("/my-project/simulations");
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
        expect(screen.getByTestId("search").textContent).toContain("scenarioId=scen_1");
      });

      expect(screen.getByTestId("selection").textContent).toBe(ALL_RUNS_ID);
      expect(screen.getByTestId("pathname").textContent).toBe("/my-project/simulations");
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
        expect(screen.getByTestId("search").textContent).toContain("groupBy=scenario");
      });

      expect(screen.getByTestId("selection").textContent).toBe(ALL_RUNS_ID);
      expect(screen.getByTestId("pathname").textContent).toBe("/my-project/simulations");
    });
  });
});

describe("given the Runs page at /my-project/simulations/run-plans/critical-path (suite detail)", () => {
  describe("when a filter is applied", () => {
    it("keeps selection as critical-path and preserves the suite path", async () => {
      const store = renderHarness("/my-project/simulations/run-plans/critical-path");

      expect(screen.getByTestId("selection").textContent).toBe("critical-path");

      await act(async () => {
        store.getState().setFilter("passFailStatus", "pass");
      });

      await waitFor(() => {
        expect(screen.getByTestId("search").textContent).toContain("passFailStatus=pass");
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
      const store = renderHarness("/my-project/simulations/python-examples");

      expect(screen.getByTestId("selection").textContent).toBe(
        `${EXTERNAL_SET_PREFIX}python-examples`,
      );

      await act(async () => {
        store.getState().setFilter("scenarioId", "scen_1");
      });

      await waitFor(() => {
        expect(screen.getByTestId("search").textContent).toContain("scenarioId=scen_1");
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
      expect(screen.getByTestId("selection").textContent).not.toContain("scen_1");
    });
  });
});
