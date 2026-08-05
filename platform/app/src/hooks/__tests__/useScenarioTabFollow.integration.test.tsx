/**
 * @vitest-environment jsdom
 *
 * Covers specs/scenarios/scenario-tab-handoff.feature — the tab-identity half.
 *
 * Renders the hook inside a real react-router, with real session storage, so
 * the query-param lift and the URL scrub are the behaviours a browser would
 * actually produce.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The global test-setup.ts stubs the router compat with an empty router. This
// hook is entirely about lifting a query param out of the URL, so it needs the
// real compat layer inside a real MemoryRouter.
vi.unmock("~/utils/compat/next-router");
vi.mock(
  "~/utils/compat/next-router",
  async () => await vi.importActual<object>("~/utils/compat/next-router"),
);

import { useScenarioTabFollow } from "../useScenarioTabFollow";

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
        <Route path="/:project/simulations/*" element={<Probe />} />
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
