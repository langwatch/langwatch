/**
 * @vitest-environment jsdom
 *
 * Covers specs/scenarios/scenario-tab-handoff.feature — the tab-identity half.
 *
 * Renders the hook inside a real react-router wrapped in a ScenarioHostPort
 * test double (mirrors runs-filter-url-sync.integration.test.tsx), so the
 * query-param lift and the URL scrub are the behaviours a browser would
 * actually produce. `useRouter` in this package reads through the host port
 * (ADR-004 seals react-router off from the package proper), so the host here
 * is the router.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useMemo, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScenarioHostPort, ScenarioHostProvider } from "../../model/scenario-host";
import { useScenarioTabFollow } from "../use-scenario-tab-follow";

/** Mirrors runs-filter-url-sync.integration.test.tsx's TestScenarioHost. */
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
        return { id: "proj-1", slug: "acme", name: "Acme" };
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
        // Not exercised here.
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

function Probe() {
  const { tabKey, tabId } = useScenarioTabFollow();

  return (
    <div>
      <span data-testid="tab-key">{tabKey ?? "none"}</span>
      <span data-testid="tab-id">{tabId ? "assigned" : "none"}</span>
      <span data-testid="search">{window.location.search}</span>
    </div>
  );
}

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/:project/simulations/*"
          element={
            <TestScenarioHost>
              <Probe />
            </TestScenarioHost>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("useScenarioTabFollow", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  describe("when the SDK opened this tab", () => {
    /** @scenario "A simulations tab opened by the SDK registers itself" */
    it("adopts the machine key from the query param", async () => {
      renderAt("/acme/simulations/checkout?scenarioTab=machine-abc");

      await waitFor(() =>
        expect(screen.getByTestId("tab-key")).toHaveTextContent("machine-abc"),
      );
      expect(screen.getByTestId("tab-id")).toHaveTextContent("assigned");
    });

    /** @scenario "The scenario tab key survives a reload but never leaks into shared links" */
    it("keeps the key for this tab only", async () => {
      renderAt("/acme/simulations/checkout?scenarioTab=machine-abc");

      await waitFor(() =>
        expect(
          window.sessionStorage.getItem("langwatch:scenario-tab-key"),
        ).toBe("machine-abc"),
      );
      expect(
        window.localStorage.getItem("langwatch:scenario-tab-key"),
      ).toBeNull();
    });

    it("recovers the key after a reload, without the query param", async () => {
      window.sessionStorage.setItem(
        "langwatch:scenario-tab-key",
        "machine-abc",
      );

      renderAt("/acme/simulations/checkout");

      await waitFor(() =>
        expect(screen.getByTestId("tab-key")).toHaveTextContent("machine-abc"),
      );
    });

    it("keeps the same tab id across re-renders", async () => {
      const { unmount } = renderAt(
        "/acme/simulations/checkout?scenarioTab=machine-abc",
      );
      await waitFor(() =>
        expect(screen.getByTestId("tab-key")).toHaveTextContent("machine-abc"),
      );
      const first = window.sessionStorage.getItem("langwatch:scenario-tab-id");
      unmount();

      renderAt("/acme/simulations/checkout");
      await waitFor(() =>
        expect(screen.getByTestId("tab-key")).toHaveTextContent("machine-abc"),
      );

      expect(window.sessionStorage.getItem("langwatch:scenario-tab-id")).toBe(
        first,
      );
      expect(first).toBeTruthy();
    });
  });

  describe("when the user opened the page themselves", () => {
    /** @scenario "A simulations tab without a scenario tab key never registers" */
    it("stays anonymous so the SDK never steers it", async () => {
      renderAt("/acme/simulations/checkout");

      await waitFor(() =>
        expect(screen.getByTestId("tab-key")).toHaveTextContent("none"),
      );
      expect(screen.getByTestId("tab-id")).toHaveTextContent("none");
    });
  });
});
