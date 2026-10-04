// @vitest-environment jsdom
import {
  UiAnalytics,
  type UiAnalyticsEvent,
  type UiAnalyticsGroup,
  type UiAnalyticsReader,
} from "@langwatch/browser-host/analytics";
import {
  BrowserUiDocumentTitle,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
  UiCapabilityContextProvider,
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetSignedInTracking, useAnalyticsIdentity } from "../use-analytics-identity";

class RecordingAnalytics extends UiAnalytics {
  readonly calls: string[] = [];
  readonly tracked: UiAnalyticsEvent[] = [];
  track(event: UiAnalyticsEvent): void {
    this.tracked.push(event);
  }
  identify(reader: UiAnalyticsReader): void {
    this.calls.push(`identify ${reader.id} ${reader.email ?? "-"}`);
  }
  group(organization: UiAnalyticsGroup): void {
    this.calls.push(`group ${organization.id} ${organization.name ?? "-"}`);
  }
  reset(): void {
    this.calls.push("reset");
  }
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
  failed(): void {}
}
class OrgScope extends UiScope {
  constructor(private readonly organizationId: string | undefined) {
    super();
  }
  activeScope(): UiActiveScope {
    return { organizationId: this.organizationId ?? null, projectId: null };
  }
}
class PersonSession extends UiSession {
  constructor(
    private readonly user: UiActor | null,
    private readonly organizationId: string | undefined,
  ) {
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
      scope: {
        status: "ready",
        organization: this.organizationId ? { id: this.organizationId } : undefined,
        team: undefined,
        project: undefined,
      },
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
  featureFlag(): boolean | undefined {
    return void 0;
  }
}
const ADA: UiActor = { id: "user_ada", name: "Ada", email: "ada@example.com", image: null };
const BOB: UiActor = { id: "user_bob", name: "Bob", email: null, image: null };

const CAMPAIGN = { utm_source: "newsletter", utm_campaign: "weekly-42" };

function capabilities(
  user: UiActor | null,
  organizationId: string | undefined,
  analytics: UiAnalytics,
  attribution: Readonly<Record<string, string>> = CAMPAIGN,
): UiCapabilities {
  return {
    documentTitle: BrowserUiDocumentTitle.create(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new BareRoute(),
    rpc: new SilentRpc(),
    scope: new OrgScope(organizationId),
    session: new PersonSession(user, organizationId),
    analytics,
    declarations: uiDeclarations([
      {
        name: "onboarding",
        installation: {
          capabilities: {
            firstTouchAttribution: {
              useCapture: () => void 0,
              eventProperties: () => attribution,
            },
          },
        },
      },
    ]),
  };
}
function Probe() {
  useAnalyticsIdentity();
  return null;
}
function draw(user: UiActor | null, organizationId: string | undefined, analytics: UiAnalytics) {
  return render(
    <UiCapabilityContextProvider value={capabilities(user, organizationId, analytics)}>
      <Probe />
    </UiCapabilityContextProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  resetSignedInTracking();
});
afterEach(cleanup);

describe("who the shell tells analytics is reading", () => {
  it("identifies the signed-in person and groups them under the organization", () => {
    const analytics = new RecordingAnalytics();
    draw(ADA, "org_1", analytics);
    expect(analytics.calls).toEqual(["identify user_ada ada@example.com", "group org_1 -"]);
  });

  it("resets before a different person is identified", () => {
    const analytics = new RecordingAnalytics();
    const view = draw(ADA, "org_1", analytics);
    view.rerender(
      <UiCapabilityContextProvider value={capabilities(BOB, "org_1", analytics)}>
        <Probe />
      </UiCapabilityContextProvider>,
    );
    expect(analytics.calls).toContain("reset");
    expect(analytics.calls.at(-2)).toBe("identify user_bob -");
  });

  it("forgets the reader when the signed-in application unmounts, and never identifies nobody", () => {
    const analytics = new RecordingAnalytics();
    const view = draw(null, undefined, analytics);
    expect(analytics.calls).toEqual([]);
    view.unmount();
    expect(analytics.calls).toEqual(["reset"]);
  });
});

describe("the signed_in event the shell sends for an identified person", () => {
  const SIGNED_IN = { name: "signed_in", attributes: CAMPAIGN };

  /** @scenario An identified user loading the app tracks signed_in with stored attribution */
  it("sends signed_in after the identify, with the attribution onboarding lends", () => {
    const analytics = new RecordingAnalytics();
    draw(ADA, "org_1", analytics);
    expect(analytics.tracked).toEqual([SIGNED_IN]);
    expect(analytics.calls[0]).toBe("identify user_ada ada@example.com");
  });

  /** @scenario signed_in without any attribution carries no attribution properties */
  it("sends signed_in with no property when there is no attribution", () => {
    const analytics = new RecordingAnalytics();
    render(
      <UiCapabilityContextProvider value={capabilities(ADA, "org_1", analytics, {})}>
        <Probe />
      </UiCapabilityContextProvider>,
    );
    expect(analytics.tracked).toEqual([{ name: "signed_in", attributes: {} }]);
  });

  /** @scenario signed_in is captured once per browser session */
  it("sends it once per browser session, across page loads of the same tab", () => {
    const first = new RecordingAnalytics();
    draw(ADA, "org_1", first).unmount();

    // A reload keeps sessionStorage and loses the module state.
    resetSignedInTracking();
    const second = new RecordingAnalytics();
    draw(ADA, "org_1", second);

    expect(first.tracked).toEqual([SIGNED_IN]);
    expect(second.tracked).toEqual([]);
  });

  it("sends it once per page load when the tab refuses session storage", () => {
    const refused = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("storage refused");
      },
    });

    try {
      const analytics = new RecordingAnalytics();
      draw(ADA, "org_1", analytics).unmount();
      draw(ADA, "org_1", analytics);
      expect(analytics.tracked).toEqual([SIGNED_IN]);
    } finally {
      if (refused) Object.defineProperty(window, "sessionStorage", refused);
    }
  });

  /** @scenario A different user signing in on the same tab tracks signed_in again */
  it("sends it again when a different person signs in on the same tab", () => {
    const analytics = new RecordingAnalytics();
    const view = draw(ADA, "org_1", analytics);
    view.rerender(
      <UiCapabilityContextProvider value={capabilities(BOB, "org_1", analytics)}>
        <Probe />
      </UiCapabilityContextProvider>,
    );
    expect(analytics.tracked).toEqual([SIGNED_IN, SIGNED_IN]);
  });

  /** @scenario Anonymous visitors track no signed_in event */
  it("never sends it for an anonymous visitor", () => {
    const analytics = new RecordingAnalytics();
    draw(null, undefined, analytics);
    expect(analytics.tracked).toEqual([]);
  });
});
