// @vitest-environment jsdom
/**
 * The authoring drawer names its scope through this port, which answered
 * undefined. Spec: specs/ui/module-host-mounting.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const ORGANIZATION_ID = "org-1";
const TEAM_ID = "team-1";

const ORGANIZATION_GRAPH = {
  id: ORGANIZATION_ID,
  name: "Local Dev Organization",
  slug: "local-dev-organization",
  teams: [{ id: TEAM_ID, name: "Local Dev Team", slug: "local-dev-team", projects: [] }],
};

const answer = vi.fn(() => ({ data: [ORGANIZATION_GRAPH] }));
vi.mock("../automation-api.ts", () => ({
  automationApi: { organization: { getAll: { useQuery: () => answer() } } },
  api: { organization: { getAll: { useQuery: () => answer() } } },
}));

// The drawer machinery is the router's, not this port's.
vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: () => void 0, goBack: () => void 0 }),
}));

import { useAutomationHost } from "../../model/automation-host.ts";
import AutomationHostMount from "../automation-host-mount.tsx";

class TestScope extends UiScope {
  constructor(
    private readonly reading: UiActiveScope,
    private readonly teamId: string,
  ) {
    super();
  }

  activeScope(): UiActiveScope {
    return this.reading;
  }

  scopeHost() {
    const teamId = this.teamId;
    return {
      project: () => void 0,
      organization: () => void 0,
      team: () => ({ id: teamId }),
      organizationRole: () => void 0,
      hasPermission: () => false,
      hasOrganizationPermission: () => false,
      isDemoProject: () => false,
      isLoading: () => false,
    };
  }
}

function harness(scope: UiActiveScope) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    scope: new TestScope(scope, TEAM_ID),
  };

  return function Harness({ children }: { children: ReactNode }) {
    return (
      <UiCapabilityContextProvider value={capabilities}>
        <AutomationHostMount>{children}</AutomationHostMount>
      </UiCapabilityContextProvider>
    );
  };
}

/** Stands in for the authoring drawer, which names the scope it writes into. */
function ScopeReader() {
  const host = useAutomationHost();

  return (
    <div>
      <span data-testid="org">{host.organization()?.slug ?? "(none)"}</span>
      <span data-testid="team">{host.team()?.slug ?? "(none)"}</span>
    </div>
  );
}

describe("given an automation host above the drawer that writes through it", () => {
  describe("when the organization graph has answered", () => {
    /** @scenario "A mounted host answers the reading its screen renders from" */
    it("names the organization and the team rather than neither", () => {
      const Harness = harness({ organizationId: ORGANIZATION_ID, projectId: null });

      render(<ScopeReader />, { wrapper: Harness });

      expect(screen.getByTestId("org")).toHaveTextContent("local-dev-organization");
      // The port wants the team's slug; the scope capability carries only its id.
      expect(screen.getByTestId("team")).toHaveTextContent("local-dev-team");
    });
  });
});
