/**
 * @vitest-environment jsdom
 * Trace's host publishes no scope of its own: a screen under it reads the shell's scope host.
 * Spec: specs/frontend/session-permission-reads.feature (scope knot, plan batch 3).
 */
import {
  createUiScopeHost,
  UiScopeHostProvider,
  useOrganizationTeamProject,
} from "@langwatch/browser-host/use-organization-team-project";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TraceHostApi, TraceHostProvider } from "../trace-host.ts";

/** The shell's scope host: the demo project, a project grant without the organization one. */
const shellScope = createUiScopeHost({
  project: () => ({ id: "proj_demo", slug: "demo", name: "Demo" }),
  organization: () => ({ id: "org_1" }),
  team: () => ({ id: "team_1" }),
  hasPermission: (permission) => permission === "project:manage",
  hasOrganizationPermission: () => false,
  isDemoProject: () => true,
});

/** A module host that would answer yes to anything, so a shadowing read would show. */
class GrantingTraceHost extends TraceHostApi {
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
    return { params: {}, query: {}, pathname: "/demo/messages" };
  }
  setQuery() {}
  navigate() {}
  succeeded() {}
  failed() {}
  askLangy() {}
  registerLangyActions() {
    return () => void 0;
  }
}

function ScopeProbe() {
  const scope = useOrganizationTeamProject();
  return (
    <>
      <output aria-label="manage organization">
        {String(scope.hasOrgPermission("organization:manage"))}
      </output>
      <output aria-label="demo project">{String(scope.isDemoProject)}</output>
    </>
  );
}

const renderUnderTraceHost = () =>
  render(
    <UiScopeHostProvider value={shellScope}>
      <TraceHostProvider value={new GrantingTraceHost()}>
        <ScopeProbe />
      </TraceHostProvider>
    </UiScopeHostProvider>,
  );

afterEach(cleanup);

describe("given the trace host is mounted under the shell's scope host", () => {
  describe("when a screen inside it asks whether the reader may manage the organization", () => {
    /** @scenario "An organization permission reads the same under every module host" */
    it("answers no, as the shell's scope answers it", () => {
      renderUnderTraceHost();
      expect(screen.getByLabelText("manage organization").textContent).toBe("false");
    });
  });

  describe("when a screen inside it reads whether it stands in the demo project", () => {
    /** @scenario "The demo project is recognised under every module host" */
    it("reads yes", () => {
      renderUnderTraceHost();
      expect(screen.getByLabelText("demo project").textContent).toBe("true");
    });
  });
});
