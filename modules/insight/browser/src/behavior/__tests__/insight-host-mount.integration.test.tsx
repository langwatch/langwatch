// @vitest-environment jsdom
/**
 * The mount reads both release flags: the Insights page lives in the Dashboards product.
 * Spec: modules/insight/specs/insight-inbox.feature
 */
import {
  UiHostServiceProvider,
  UiHostServicesContextProvider,
  UiSession,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import { UiFlagsService } from "@langwatch/browser-host/feature-flag";
import type { UiSessionSnapshot } from "@langwatch/browser-host/session";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useInsightHost } from "../../model/insight-host.ts";
import InsightHostMount from "../insight-host-mount.tsx";

const PROJECT = { id: "proj-1", slug: "acme", name: "Acme" };

class ProjectSession extends UiSession {
  currentUser() {
    return null;
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }

  override snapshot(): UiSessionSnapshot {
    return {
      session: { status: "anonymous", user: null },
      scope: { status: "ready", organization: { id: "org-1" }, team: undefined, project: PROJECT },
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => true,
        canInOrganization: () => true,
      },
    };
  }
}

/** Stands in for the bell and the menu entry: each asks the host whether Insights is on. */
function EnabledReader() {
  return <span data-testid="enabled">{String(useInsightHost().isEnabled())}</span>;
}

function renderWithFlags(answers: Readonly<Record<string, boolean>>) {
  const flags = { flag: ({ name }: { name: string }) => answers[name] };
  const capabilities: UiHostServices = createUiHostServicesFromHost(
    { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
    new ProjectSession(),
  );
  render(
    <UiHostServiceProvider value={new Map([[UiFlagsService.name, flags]])}>
      <UiHostServicesContextProvider value={capabilities}>
        <InsightHostMount>
          <EnabledReader />
        </InsightHostMount>
      </UiHostServicesContextProvider>
    </UiHostServiceProvider>,
  );
}

describe("given the insight host mounted over the project in scope", () => {
  describe("when the flags service answers the two release flags", () => {
    /** @scenario "Insights shows nothing while release_dashboards is off" */
    it.each([
      { insights: true, dashboards: true, enabled: "true" },
      { insights: true, dashboards: false, enabled: "false" },
      { insights: false, dashboards: true, enabled: "false" },
    ])(
      "reports Insights on only with both on (insights $insights, dashboards $dashboards)",
      ({ insights, dashboards, enabled }) => {
        renderWithFlags({ release_insights: insights, release_dashboards: dashboards });

        expect(screen.getByTestId("enabled")).toHaveTextContent(enabled);
      },
    );
  });
});
