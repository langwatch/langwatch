/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://app.langwatch.ai/" }
 *
 * The run card's "Open in Simulations" link used to always point at the
 * simulations INDEX page, whatever run the card was actually showing — a
 * rebuilt href cannot address one run at all. This locks that the card
 * prefers the platform's own `platformUrl` (from the CLI result) — the run's
 * `scenarioRunDetail` drawer link — and rides the SPA router when it does.
 *
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LangyHostPort,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../../model/langy-host";
import { resolveCapability } from "../../../../model/capabilities/capability-registry";
import { LangyEvalRunCard } from "../langy-eval-run-card";

import { UiCapabilityContextProvider } from "@langwatch/ui-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/ui-host/testing";

const navigateMock = vi.fn();

class FakeLangyHost extends LangyHostPort {
  project(): LangyHostProject | undefined {
    return { id: "project-acme", slug: "acme", name: "acme" };
  }
  organization(): LangyHostOrganization | undefined {
    return { id: "org-1" };
  }
  team(): LangyHostTeam | undefined {
    return { id: "team-1" };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1", email: "staff@langwatch.ai" };
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  featureFlag() {
    return true;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/" };
  }
  setQuery() {}
  navigate(to: string) {
    navigateMock(to);
  }
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}
const host = new FakeLangyHost();

vi.mock("../../../../behavior/use-capability-data", () => ({
  useCapabilityData: () => ({
    status: "unavailable",
    rows: [],
    loadedCount: 0,
    totalCount: 0,
    isHydrating: false,
  }),
}));

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
});

const descriptor = resolveCapability("langwatch.simulation-run.get")!;

function renderCard(output: unknown) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider value={createUiCapabilitiesFromHost(host)}>
        <LangyHostProvider value={host}>
          <LangyEvalRunCard descriptor={descriptor} input={{}} output={output} projectSlug="acme" />
        </LangyHostProvider>
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
}

describe("Feature: the platform's link for a resource addresses that resource, not an index", () => {
  describe("Rule: a card's open link is the platform's link for the resource it shows", () => {
    describe("given Langy fetched one scenario run and shows its card", () => {
      /** @scenario "A scenario card links to the run it shows, not the simulations list" */
      it("targets that specific run, not the simulations index page", () => {
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
      it("uses that link, not a rebuilt index-page link", () => {
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
      });
    });

    describe("when I click a card's open link for a resource on this LangWatch instance", () => {
      /** @scenario "Opening a card's platform link stays in the app" */
      it("uses in-app navigation, not a full page load", () => {
        renderCard({
          scenarioRunId: "run_1",
          status: "completed",
          platformUrl:
            "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
        });

        fireEvent.click(screen.getByText(/Open in Simulations/i));
        expect(navigateMock).toHaveBeenCalledWith(
          "/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
        );
      });
    });
  });
});
