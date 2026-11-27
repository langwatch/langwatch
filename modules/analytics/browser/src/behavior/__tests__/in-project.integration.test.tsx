/**
 * @vitest-environment jsdom
 * An org-level board runs inside `InProject`, in the project it opens in: grants and product
 * events below it are that project's, and the page's own come back after.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */
import { type UiAnalyticsEvent, useUiAnalytics } from "@langwatch/browser-host/analytics";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  RecordingUiAnalytics,
  withAnalytics,
} from "../../features/dashboards/__tests__/render-dashboards.test-helpers.tsx";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { AnalyticsTestHarness, StubAnalyticsHost } from "../../testing.tsx";
import { InProject } from "../in-project.tsx";

const PAGE = { id: "proj-page", slug: "page", name: "Page", hasFirstMessage: true };
const SHOP = { id: "proj-shop", slug: "shop", name: "Shop" };

/** Keeps registered properties as PostHog does, and notes the projectId each event carried. */
class RegisteringUiAnalytics extends RecordingUiAnalytics {
  readonly properties = new Map<string, unknown>();
  readonly sentAbout: unknown[] = [];

  override track(event: UiAnalyticsEvent): void {
    super.track(event);
    this.sentAbout.push(this.properties.get("projectId"));
  }

  override register(properties: Readonly<Record<string, unknown>>): void {
    for (const [name, value] of Object.entries(properties)) this.properties.set(name, value);
  }

  override unregister(property: string): void {
    this.properties.delete(property);
  }
}

/** What a board below `InProject` reads: its project, two grants, and a tracked action. */
function BoardProbe() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const grant = (permission: string) => `${permission}=${host.hasPermission(permission)}`;
  return (
    <button onClick={() => analytics.track({ name: "dashboard", action: "viewed" })}>
      {`${host.project()?.id} ${grant("analytics:view")} ${grant("analytics:create")}`}
    </button>
  );
}

function openBoard({
  host,
  analytics,
}: {
  host: StubAnalyticsHost;
  analytics?: RecordingUiAnalytics;
}) {
  const board = (
    <InProject project={SHOP}>
      <BoardProbe />
    </InProject>
  );
  render(
    <AnalyticsTestHarness host={host}>
      {analytics ? withAnalytics(board, analytics) : board}
    </AnalyticsTestHarness>,
  );
  return { user: userEvent.setup() };
}

afterEach(cleanup);

describe("an org-level board opened in Shop", () => {
  describe("given a page about no project", () => {
    /** @scenario "An org-level board opened in another project answers from that project's grants" */
    it("answers from the member's own grants in Shop", () => {
      const host = new StubAnalyticsHost({
        project: undefined,
        permissions: ["analytics:create"],
        projectPermissions: { [SHOP.id]: ["analytics:view"] },
      });

      openBoard({ host });

      expect(
        screen.getByRole("button", {
          name: "proj-shop analytics:view=true analytics:create=false",
        }),
      ).toBeInTheDocument();
    });

    /** @scenario "Events from an org-level board are about the project it opens in" */
    it("sends its events about Shop, and later ones about no project", async () => {
      const analytics = new RegisteringUiAnalytics();
      const host = new StubAnalyticsHost({ project: undefined });
      const { user } = openBoard({ host, analytics });

      await user.click(screen.getByRole("button"));
      analytics.track({ name: "page", action: "viewed" });

      expect(analytics.sentAbout).toEqual([SHOP.id, undefined]);
    });
  });

  describe("given a page about Shop itself", () => {
    /** @scenario "An org-level board opened in another project answers from that project's grants" */
    it("answers from the page's grants, with no read of Shop's", () => {
      const host = new StubAnalyticsHost({
        project: { ...SHOP, hasFirstMessage: true },
        permissions: ["analytics:view", "analytics:create"],
        projectPermissions: {},
      });

      openBoard({ host });

      expect(
        screen.getByRole("button", { name: "proj-shop analytics:view=true analytics:create=true" }),
      ).toBeInTheDocument();
    });
  });

  describe("given a page about another project", () => {
    /** @scenario "Events from an org-level board are about the project it opens in" */
    it("sends its events about Shop, then puts the page's project back", async () => {
      const analytics = new RegisteringUiAnalytics();
      analytics.register({ projectId: PAGE.id });
      const { user } = openBoard({ host: new StubAnalyticsHost({ project: PAGE }), analytics });

      await user.click(screen.getByRole("button"));
      analytics.track({ name: "page", action: "viewed" });

      expect(analytics.sentAbout).toEqual([SHOP.id, PAGE.id]);
    });
  });
});
