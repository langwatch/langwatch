// @vitest-environment jsdom
/**
 * @see modules/automation/specs/alert-link-opened.feature
 */
import { UiAnalytics, type UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import {
  BrowserUiDocumentTitle,
  type UiActiveScope,
  type UiActor,
  type UiHostServices,
  UiHostServicesContextProvider,
  UiFeedback,
  UiNavigation,
  UiRoute,
  UiRpc,
  UiScope,
  UiSession,
} from "@langwatch/browser-host/capabilities";
import { uiDeclarations } from "@langwatch/browser-host/declarations";
import type { UiSessionSnapshot } from "@langwatch/browser-host/session";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { useAlertLinkOpened } from "../use-alert-link-opened";

class RecordingAnalytics extends UiAnalytics {
  readonly tracked: UiAnalyticsEvent[] = [];
  track(event: UiAnalyticsEvent): void {
    this.tracked.push(event);
  }
  identify(): void {}
  group(): void {}
  reset(): void {}
}
class SilentRpc extends UiRpc {
  query(): Promise<unknown> {
    return Promise.resolve(null);
  }
  mutate(): Promise<unknown> {
    return Promise.resolve(null);
  }
  subscribe() {
    return { unsubscribe: () => void 0 };
  }
}
class SilentNavigation extends UiNavigation {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}
class BareRoute extends UiRoute {
  reading() {
    return { params: {}, query: {} };
  }
  setQuery(): void {}
}
class SilentFeedback extends UiFeedback {
  succeeded(): void {}
  warned(): void {}
  informed(): void {}
  failed(): void {}
}
class NoScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: null, projectId: null };
  }
}
class PersonSession extends UiSession {
  constructor(private readonly user: UiActor | null) {
    super();
  }
  currentUser(): UiActor | null {
    return this.user;
  }
  snapshot(): UiSessionSnapshot {
    return {
      session: this.user
        ? { status: "authenticated", user: this.user }
        : { status: "anonymous", user: null },
      scope: { status: "ready", organization: undefined, team: undefined, project: undefined },
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => false,
        canInOrganization: () => false,
      },
    };
  }
  hasPermission(): boolean {
    return false;
  }
  isSettled(): boolean {
    return true;
  }
}

const ADA: UiActor = { id: "user_ada", name: "Ada", email: "ada@example.com", image: null };

function hostServices(user: UiActor | null, analytics: UiAnalytics): UiHostServices {
  return {
    documentTitle: BrowserUiDocumentTitle.create(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new BareRoute(),
    rpc: new SilentRpc(),
    scope: new NoScope(),
    session: new PersonSession(user),
    analytics,
    declarations: uiDeclarations([]),
  };
}

/** Mounts the hook at an address the browser and the router both hold. */
function open({ user, at }: { user: UiActor | null; at: string }) {
  window.history.replaceState({ idx: 0 }, "", at);
  const analytics = new RecordingAnalytics();
  const entriesBefore = window.history.length;
  function Probe() {
    useAlertLinkOpened();
    return null;
  }
  render(
    <UiHostServicesContextProvider value={hostServices(user, analytics)}>
      <MemoryRouter initialEntries={[at]}>
        <Probe />
      </MemoryRouter>
    </UiHostServicesContextProvider>,
  );
  const address = () =>
    `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return { analytics, address, entriesBefore };
}

afterEach(cleanup);

describe("useAlertLinkOpened", () => {
  describe("when a signed-in member opens an alert's trace link", () => {
    /** @scenario "Opening an alert link sends one event and replaces the marker out of history" */
    it("sends one automations.opened.alert_link and replaces the marker in place", () => {
      const { analytics, address, entriesBefore } = open({
        user: ADA,
        at: "/demo/traces/trace-1?t=1&lw_from=alert#spans",
      });

      expect(analytics.tracked).toEqual([
        {
          boundary: "automations",
          action: "opened",
          name: "alert_link",
          attributes: { landedOn: "trace" },
        },
      ]);
      expect(address()).toBe("/demo/traces/trace-1?t=1#spans");
      expect(window.history.length).toBe(entriesBefore);
      expect(window.history.state).toEqual({ idx: 0 });
      expect(JSON.stringify(analytics.tracked)).not.toContain("trace-1");
    });
  });

  describe("when the page has no marker or nobody is signed in", () => {
    /** @scenario "A page without the marker, or a signed-out reader, sends nothing" */
    it("sends nothing", () => {
      const plain = open({ user: ADA, at: "/demo/traces/trace-1?t=1" });
      expect(plain.analytics.tracked).toEqual([]);
      cleanup();

      const signedOut = open({ user: null, at: "/demo/traces/trace-1?lw_from=alert" });
      expect(signedOut.analytics.tracked).toEqual([]);
      expect(signedOut.address()).toBe("/demo/traces/trace-1?lw_from=alert");
    });
  });
});
