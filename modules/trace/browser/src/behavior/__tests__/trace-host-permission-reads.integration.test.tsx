/**
 * @vitest-environment jsdom
 * A trace screen asks its own host for a permission, and reads what the legacy scope hook read.
 * Spec: specs/frontend/session-permission-reads.feature (scope knot, plan batch 4a).
 */
import {
  createUiScopeHost,
  UiScopeHostProvider,
} from "@langwatch/browser-host/use-organization-team-project";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useCanAskLangy } from "../langy/use-can-ask-langy.ts";
import { TraceHostApi, TraceHostProvider } from "../trace-host.ts";

/** One session's grants, answered by both the shell's scope host and trace's host mount. */
class SessionTraceHost extends TraceHostApi {
  constructor(private readonly grants: ReadonlySet<string>) {
    super();
  }
  project() {
    return { id: "proj_1", slug: "acme", name: "Acme" };
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
    return { id: "user_1" };
  }
  hasPermission(permission: string) {
    return this.grants.has(permission);
  }
  isLoading() {
    return false;
  }
  route() {
    return { params: {}, query: {}, pathname: "/acme/messages" };
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

function Probe() {
  const canAsk = useCanAskLangy();
  return (
    <>
      <output aria-label="migrated">{String(canAsk)}</output>
    </>
  );
}

const renderFor = (grants: ReadonlySet<string>) =>
  render(
    <UiScopeHostProvider
      value={createUiScopeHost({
        project: () => ({ id: "proj_1", slug: "acme", name: "Acme" }),
        organization: () => ({ id: "org_1" }),
        team: () => ({ id: "team_1" }),
      })}
    >
      <TraceHostProvider value={new SessionTraceHost(grants)}>
        <Probe />
      </TraceHostProvider>
    </UiScopeHostProvider>,
  );

afterEach(cleanup);

describe("given a signed-in reader whose role grants some permissions and not others", () => {
  describe("when a migrated trace screen reads a permission from the trace host", () => {
    /** @scenario "A migrated screen answers a signed-in reader the same as before" */
    it.each([
      ["held", new Set(["langy:view", "langy:create"]), "true"],
      ["not held", new Set(["langy:view"]), "false"],
    ])("reads a %s permission as the legacy scope hook did", (_label, grants, expected) => {
      renderFor(grants);
      expect(screen.getByLabelText("migrated").textContent).toBe(expected);
    });
  });
});
