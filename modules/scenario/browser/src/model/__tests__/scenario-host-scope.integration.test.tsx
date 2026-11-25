/**
 * @vitest-environment jsdom
 * Scenario's host publishes no scope of its own: a screen under it reads the shell's scope host.
 * Spec: specs/frontend/session-permission-reads.feature (scope knot, plan batch 3).
 */
import {
  createUiScopeHost,
  UiScopeHostProvider,
  useOrganizationTeamProject,
} from "@langwatch/browser-host/use-organization-team-project";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScenarioHostApi, ScenarioHostProvider } from "../scenario-host.ts";

/** The shell's scope host, standing in the demo project. */
const shellScope = createUiScopeHost({
  project: () => ({ id: "proj_demo", slug: "demo", name: "Demo" }),
  organization: () => ({ id: "org_1" }),
  team: () => ({ id: "team_1" }),
  isDemoProject: () => true,
});

/** A module host that would answer yes to anything, so a shadowing read would show. */
class GrantingScenarioHost extends ScenarioHostApi {
  project() {
    return { id: "proj_demo", slug: "demo", name: "Demo" };
  }
  organization() {
    return { id: "org_1" };
  }
  team() {
    return { id: "team_1" };
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
    return { params: {}, query: {}, pathname: "/demo/simulations" };
  }
  setQuery() {}
  navigate() {}
  succeeded() {}
  failed() {}
}

function ScopeProbe() {
  const scope = useOrganizationTeamProject();
  return (
    <>
      <output aria-label="demo project">{String(scope.isDemoProject)}</output>
    </>
  );
}

const renderUnderScenarioHost = () =>
  render(
    <UiScopeHostProvider value={shellScope}>
      <ScenarioHostProvider value={new GrantingScenarioHost()}>
        <ScopeProbe />
      </ScenarioHostProvider>
    </UiScopeHostProvider>,
  );

afterEach(cleanup);

describe("given the scenario host is mounted under the shell's scope host", () => {
  describe("when a screen inside it reads whether it stands in the demo project", () => {
    /** @scenario "The demo project is recognised under every module host" */
    it("reads yes", () => {
      renderUnderScenarioHost();
      expect(screen.getByLabelText("demo project").textContent).toBe("true");
    });
  });
});
