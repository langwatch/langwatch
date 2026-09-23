// @vitest-environment jsdom
import {
  UiAnalytics,
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
import type { UiSessionSnapshot } from "@langwatch/browser-host/session";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useAnalyticsIdentity } from "../use-analytics-identity";

class RecordingAnalytics extends UiAnalytics {
  readonly calls: string[] = [];
  track(): void {}
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

function capabilities(
  user: UiActor | null,
  organizationId: string | undefined,
  analytics: UiAnalytics,
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
