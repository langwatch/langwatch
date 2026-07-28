/**
 * @vitest-environment jsdom
 *
 * The scenario-run card's "Open in Simulations" link used to always point at
 * the simulations INDEX page, whatever run the card was actually showing —
 * the rebuilt `buildSurfaceHref` cannot address one run at all. This locks
 * that the card now prefers the platform's own `platformUrl` (from the CLI
 * result) — the run's `scenarioRunDetail` drawer link — and rides the SPA
 * router when it does.
 *
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));
// Opportunistic name hydration goes through tRPC; the deep-link behavior
// under test doesn't need it.
vi.mock("../hooks/useCapabilityData", () => ({
  useCapabilityData: () => ({
    status: "unavailable",
    rows: [],
    loadedCount: 0,
    totalCount: 0,
    isHydrating: false,
  }),
}));

import { LangyEvalRunCard } from "../components/capabilities/LangyEvalRunCard";
import { resolveCapability } from "../components/capabilities/capabilityRegistry";

const descriptor = resolveCapability("langwatch.simulation-run.get")!;

function renderCard(output: unknown) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyEvalRunCard
        descriptor={descriptor}
        input={{}}
        output={output}
        projectSlug="acme"
      />
    </ChakraProvider>,
  );
}

// The jsdom window is shared across files in a worker: stub location for the
// origin comparison, and RESTORE it so later suites that navigate for real
// (LangyExternalLinkGuard) aren't poisoned by a leaked bare-object stub.
const realLocation = window.location;

beforeEach(() => {
  // `CapabilityDeepLinkChip` compares a CLI result's `platformUrl` against
  // `window.location.origin` (BASE_HOST isn't exposed to the client bundle)
  // to decide whether the link belongs to this instance.
  Object.defineProperty(window, "location", {
    value: { origin: "https://app.langwatch.ai" },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: realLocation,
    writable: true,
    configurable: true,
  });
  cleanup();
  pushMock.mockClear();
});

describe("Feature: the platform's link for a resource addresses that resource, not an index", () => {
  describe("Rule: a card's open link is the platform's link for the resource it shows", () => {
    describe("given Langy fetched one scenario run and shows its card", () => {
      /** @scenario "A scenario card links to the run it shows, not the simulations list" */
      it("the card's open link targets that specific run, not the simulations index page", () => {
        renderCard({
          scenarioRunId: "run_1",
          status: "completed",
          platformUrl:
            "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
        });

        const link = screen.getByText(/Open in Simulations/i).closest("a")!;
        expect(link.getAttribute("href")).toBe(
          "/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
        );
        expect(link.getAttribute("href")).not.toBe("/acme/simulations");
      });
    });

    describe("given the CLI result carries the platform's own link to the resource", () => {
      /** @scenario "A card prefers the platform link over a rebuilt one" */
      it("the card's open action uses that link, not a rebuilt index-page link", () => {
        renderCard({
          scenarioRunId: "run_1",
          status: "completed",
          platformUrl:
            "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
        });

        const link = screen.getByText(/Open in Simulations/i).closest("a")!;
        // Never the rebuilt `buildSurfaceHref` fallback (`/acme/simulations`
        // — simulations isn't in SURFACE_ACCEPTS_ID precisely because the bare
        // index cannot address one run; only the platform's drawer link can).
        expect(link.getAttribute("href")).toBe(
          "/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
        );
      });
    });

    describe("when I click a card's open link for a resource on this LangWatch instance", () => {
      /** @scenario "Opening a card's platform link stays in the app" */
      it("the move uses in-app navigation, not a full page load", () => {
        renderCard({
          scenarioRunId: "run_1",
          status: "completed",
          platformUrl:
            "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
        });

        fireEvent.click(screen.getByText(/Open in Simulations/i));
        expect(pushMock).toHaveBeenCalledWith(
          "/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
        );
      });

      it("leaves cmd/ctrl-click alone for a real new-tab open", () => {
        renderCard({
          scenarioRunId: "run_1",
          status: "completed",
          platformUrl:
            "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
        });

        fireEvent.click(screen.getByText(/Open in Simulations/i), {
          metaKey: true,
        });
        expect(pushMock).not.toHaveBeenCalled();
      });
    });

    describe("given no CLI result link travelled (an older turn, or a resource with no address)", () => {
      it("falls back to the card's own rebuilt link", () => {
        renderCard({ scenarioRunId: "run_1", status: "completed" });

        const link = screen.getByText(/Open in Simulations/i).closest("a")!;
        expect(link.getAttribute("href")).toBe("/acme/simulations");
      });
    });
  });
});
