// @vitest-environment jsdom
// Spec: specs/langy/langy-trace-explorer-actions.feature
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TraceHostApi,
  TraceHostProvider,
  type TraceLangyActionHandlers,
} from "../../../../../behavior/trace-host.ts";
import { ExplorerLangyActions } from "../explorer-langy-actions.tsx";

/** A host that does nothing but remember what the page published to it. */
class FixtureTraceHost extends TraceHostApi {
  registered: TraceLangyActionHandlers | undefined;
  readonly withdraw = vi.fn();

  project() {
    return { id: "project_1", slug: "demo", name: "Demo" };
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
    return { params: {}, query: {}, pathname: "/demo/traces" };
  }
  setQuery() {}
  navigate() {}
  succeeded() {}
  failed() {}

  askLangy() {}

  registerLangyActions(handlers: TraceLangyActionHandlers): () => void {
    this.registered = handlers;
    return () => {
      this.registered = void 0;
      this.withdraw();
    };
  }
}

const renderWithHost = (host: FixtureTraceHost) =>
  render(
    <TraceHostProvider value={host}>
      <ExplorerLangyActions />
    </TraceHostProvider>,
  );

describe("ExplorerLangyActions", () => {
  afterEach(cleanup);

  describe("when the Trace Explorer is open", () => {
    /** @scenario "The Trace Explorer registers its actions with Langy while it is open" */
    it("publishes a handler for every explorer action the page can run", () => {
      const host = new FixtureTraceHost();

      renderWithHost(host);

      expect(Object.keys(host.registered ?? {}).toSorted()).toEqual([
        "explorer.getState",
        "explorer.select",
        "explorer.setFilter",
        "explorer.setLens",
        "explorer.setPage",
        "explorer.setSort",
        "explorer.setTimeRange",
      ]);
    });

    it("gives every published handler the schema its payload is checked against", () => {
      const host = new FixtureTraceHost();

      renderWithHost(host);

      for (const handler of Object.values(host.registered ?? {})) {
        expect(handler.payloadSchema).toBeDefined();
        expect(typeof handler.run).toBe("function");
      }
    });
  });

  describe("when the page closes", () => {
    it("withdraws what it published, so another page is not offered them", () => {
      const host = new FixtureTraceHost();
      const { unmount } = renderWithHost(host);

      unmount();

      expect(host.withdraw).toHaveBeenCalledTimes(1);
      expect(host.registered).toBeUndefined();
    });
  });

  describe("when no host is mounted", () => {
    it("renders without publishing anything, so the shared page still works", () => {
      expect(() => render(<ExplorerLangyActions />)).not.toThrow();
    });
  });
});
