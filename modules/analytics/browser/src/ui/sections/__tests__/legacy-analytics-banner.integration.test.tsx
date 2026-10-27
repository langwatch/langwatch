/**
 * @vitest-environment jsdom
 * The legacy analytics view points at Dashboards, only where Dashboards opens.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";
import { LegacyAnalyticsBanner } from "../legacy-analytics-banner.tsx";

const PROJECT = { id: "proj-1", slug: "checkout", name: "Checkout Agent", hasFirstMessage: true };

function renderBanner(options: ConstructorParameters<typeof StubAnalyticsHost>[0]) {
  render(
    <AnalyticsTestHarness host={new StubAnalyticsHost({ project: PROJECT, ...options })}>
      <LegacyAnalyticsBanner />
    </AnalyticsTestHarness>,
  );
}

afterEach(cleanup);

describe("given the legacy analytics page", () => {
  describe("when the dashboards flag is on for the project", () => {
    /** @scenario "AC3c The legacy Analytics page offers Dashboards when the flag is on" */
    it("warns it is the legacy view and links to the project's Dashboards", () => {
      renderBanner({ flags: { release_dashboards: true } });

      expect(screen.getByTestId("legacy-analytics-banner")).toHaveTextContent("legacy analytics");
      expect(screen.getByRole("link", { name: "Open Dashboards" })).toHaveAttribute(
        "href",
        "/checkout/dashboards",
      );
    });
  });

  describe("when the dashboards flag is off", () => {
    /** @scenario "AC3d The legacy Analytics page shows no banner when the flag is off" */
    it("shows no banner", () => {
      renderBanner({ flags: { release_dashboards: false } });

      expect(screen.queryByTestId("legacy-analytics-banner")).toBeNull();
    });
  });

  describe("when the member lacks analytics:view", () => {
    /** @scenario "AC3e The legacy Analytics page shows no banner to a member without analytics:view" */
    it("shows no banner, as Dashboards would be refused", () => {
      renderBanner({ flags: { release_dashboards: true }, permissions: [] });

      expect(screen.queryByTestId("legacy-analytics-banner")).toBeNull();
    });
  });
});
