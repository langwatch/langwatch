/**
 * @vitest-environment jsdom
 *
 * The Agent Testing address is behind the release flag AND behind permission
 * to read scenarios. The flag decides whether the address exists at all, and
 * it grants nothing on its own.
 *
 * MOVED from `platform/app/src/pages/__tests__/agentTestingRouteGuards.integration.test.tsx`,
 * where the two guards were higher-order components the page composed itself.
 * They are now the route's own declaration, so the route install is what is
 * rendered here.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ flagEnabled: true, permitted: true }));

vi.mock("@langwatch/scenario-web/screens/simulations", () => ({
  scenarioScreens: {
    simulations: async () => ({ default: () => null }),
    scenarioLibrary: async () => ({ default: () => null }),
    agentTesting: async () => ({
      default: () => <h1>Agent Testing</h1>,
    }),
  },
}));

vi.mock("../ui/sections/host", () => ({
  ScenarioHost: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import {
  UiCapabilityContextProvider,
  UiDocumentTitlePort,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/ui-host/capabilities";
import { simulationsPageLoaders } from "../ui/sections/routes";

const AGENT_TESTING_PAGE = "pages/[project]/agent-testing/[[...path]]";
const SCENARIOS_PERMISSION = "scenarios:view";

class SilentNavigation extends UiNavigationPort {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class SilentRoute extends UiRoutePort {
  reading() {
    return { params: { project: "demo" }, query: {} };
  }
  setQuery(): void {}
}

class SilentFeedback extends UiFeedbackPort {
  succeeded(): void {}
  failed(): void {}
}

class SilentTitle extends UiDocumentTitlePort {
  set(): () => void {
    return () => {};
  }
}

/** The reader the guard asks: a flag answer and one grant. */
class GuardedSession extends UiSessionPort {
  currentUser() {
    return { id: "user-1", name: "Reader", email: "reader@example.com", image: null };
  }
  activeScope(): UiActiveScope {
    return { organizationId: "organization-1", projectId: "project-1" };
  }
  hasPermission(permission: string): boolean {
    return guard.permitted && permission === SCENARIOS_PERMISSION;
  }
  isSettled(): boolean {
    return true;
  }
  featureFlag(): boolean | undefined {
    return guard.flagEnabled;
  }
}

const capabilities = {
  session: new GuardedSession(),
  navigation: new SilentNavigation(),
  route: new SilentRoute(),
  feedback: new SilentFeedback(),
  documentTitle: new SilentTitle(),
} as unknown as UiCapabilities;

async function renderAgentTestingAddress() {
  const loader = simulationsPageLoaders[AGENT_TESTING_PAGE];
  if (!loader) throw new Error(`No route install for ${AGENT_TESTING_PAGE}`);
  const Page = (await loader()).default as ComponentType;

  return render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider value={capabilities}>
        <Page />
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  guard.flagEnabled = true;
  guard.permitted = true;
});

afterEach(cleanup);

describe("the Agent Testing address", () => {
  describe("given the release flag is off", () => {
    beforeEach(() => {
      guard.flagEnabled = false;
    });

    /** @scenario "With the flag off the Agent Testing route is not reachable" */
    it("does not show the page, and shows a page a person can read", async () => {
      await renderAgentTestingAddress();

      expect(screen.queryByRole("heading", { name: "Agent Testing" })).toBeNull();
      expect(screen.getByText("This page is not here")).toBeTruthy();
    });
  });

  describe("given the release flag is on", () => {
    /** @scenario "With the flag on the Agent Testing page opens" */
    it("shows the page", async () => {
      await renderAgentTestingAddress();

      expect(screen.getByRole("heading", { name: "Agent Testing" })).toBeTruthy();
    });

    describe("and the person may not read scenarios", () => {
      beforeEach(() => {
        guard.permitted = false;
      });

      /** @scenario "A person without permission to read scenarios cannot open the page" */
      it("refuses the page, so the flag alone grants nothing", async () => {
        await renderAgentTestingAddress();

        expect(screen.queryByRole("heading", { name: "Agent Testing" })).toBeNull();
        expect(screen.getByText("You do not have access to this page")).toBeTruthy();
      });
    });
  });
});
