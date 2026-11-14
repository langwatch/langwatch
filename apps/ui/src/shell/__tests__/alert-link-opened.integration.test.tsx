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
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, useLocation, useSearchParams } from "react-router";
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

/** A router entry for an address, its pathname, query and hash apart. */
function entryOf(at: string) {
  const { pathname, search, hash } = new URL(at, "https://app.test");
  return { pathname, search, hash };
}

/** Mounts the hook at an address, with a probe on the router's location and search setter. */
function open({ user, at }: { user: UiActor | null; at: string }) {
  const analytics = new RecordingAnalytics();
  const router: { address: string; state: unknown; setSearch?: (query: string) => void } = {
    address: "",
    state: undefined,
  };
  function Probe() {
    useAlertLinkOpened();
    const location = useLocation();
    const [, setSearchParams] = useSearchParams();
    router.address = `${location.pathname}${location.search}${location.hash}`;
    router.state = location.state;
    router.setSearch = (query) =>
      setSearchParams((params) => {
        params.set("q", query);
        return params;
      });
    return null;
  }
  render(
    <UiHostServicesContextProvider value={hostServices(user, analytics)}>
      <MemoryRouter initialEntries={[{ ...entryOf(at), state: { from: "mail" } }]}>
        <Probe />
      </MemoryRouter>
    </UiHostServicesContextProvider>,
  );
  return { analytics, router };
}

afterEach(cleanup);

const OPENED = {
  boundary: "automations",
  action: "opened",
  name: "alert_link",
  attributes: { landedOn: "trace" },
};

describe("useAlertLinkOpened", () => {
  describe("when a signed-in member opens an alert's trace link", () => {
    /** @scenario "Opening an alert link sends one event and replaces the marker out of history" */
    it("sends one automations.opened.alert_link and the router drops the marker", () => {
      const { analytics, router } = open({
        user: ADA,
        at: "/demo/traces/trace-1?t=1&lw_from=alert#spans",
      });

      expect(analytics.tracked).toEqual([OPENED]);
      expect(router.address).toBe("/demo/traces/trace-1?t=1#spans");
      expect(router.state).toEqual({ from: "mail" });
      expect(JSON.stringify(analytics.tracked)).not.toContain("trace-1");
    });
  });

  describe("when the page later updates its search", () => {
    /** @scenario "A later search update keeps the marker gone and sends nothing more" */
    it("keeps the marker gone and the event sent once", () => {
      const { analytics, router } = open({ user: ADA, at: "/demo/traces/trace-1?lw_from=alert" });

      act(() => router.setSearch?.("errors"));

      expect(router.address).toBe("/demo/traces/trace-1?q=errors");
      expect(analytics.tracked).toEqual([OPENED]);
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
      expect(signedOut.router.address).toBe("/demo/traces/trace-1?lw_from=alert");
    });
  });
});
