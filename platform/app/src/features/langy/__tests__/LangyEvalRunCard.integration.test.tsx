/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://app.langwatch.ai/" }
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
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { resolveCapability } from "../components/capabilities/capabilityRegistry";
import { LangyEvalRunCard } from "../components/capabilities/LangyEvalRunCard";

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

// `CapabilityDeepLinkChip` compares a CLI result's `platformUrl` against
// `window.location.origin` (BASE_HOST isn't exposed to the client bundle) to
// decide whether the link belongs to this instance. The origin comes from the
// document's own URL, declared in the docblock above, rather than from a stand-in
// object assigned over `window.location` — jsdom defines `location` as a
// non-configurable accessor, so replacing it throws outright once the file runs
// in a VM context, and a real URL is the more faithful fixture in any case.

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

describe("Feature: a run card reports the run, not the data the run returned", () => {
  describe("given the failing rows of a run that succeeded", () => {
    /** @scenario "A run card reads its state from the run, not from its rows" */
    it("shows no failure, and counts the rows instead of printing their JSON", () => {
      renderCard(
        JSON.stringify({
          runId: "silent-ideal-owl",
          progress: 20,
          total: 20,
          meta: { filter: "failed" },
          evaluations: [
            {
              targetId: "target-1",
              passed: false,
              details: "the reply failed to name the refund window",
            },
            { targetId: "target-1", passed: true, details: "matches" },
          ],
        }),
      );

      expect(screen.queryByText("failed")).toBeNull();
      expect(screen.getByText("20 of 20 rows")).toBeDefined();
      expect(screen.getByText("1 of 2 evaluations passed")).toBeDefined();
      expect(screen.queryByText(/"evaluations"/)).toBeNull();
    });
  });

  describe("given the run's own status document", () => {
    it("shows the status the run reported for itself", () => {
      renderCard(
        JSON.stringify({
          runId: "silent-ideal-owl",
          status: "completed",
          progress: 20,
          total: 20,
        }),
      );

      expect(screen.getByText("completed")).toBeDefined();
    });
  });
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
