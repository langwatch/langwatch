// @vitest-environment jsdom
/**
 * A card keeps a partial widget's face clean: what the data is missing goes in its (i), with a
 * way to price the models that have none.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import type { QueryCompleteness } from "@langwatch/analytics-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { usePublishWidgetCompleteness } from "../../../../../behavior/widget-completeness-sink.ts";
import { combineCompleteness } from "../../../../../model/dashboard-widget/widget-completeness.ts";
import { renderWithAnalyticsHost } from "../../../../../testing.tsx";
import { WidgetCardShell } from "../widget-card-shell.tsx";

afterEach(cleanup);

const PARTIAL: QueryCompleteness = {
  state: "partial",
  unit: "traces",
  total: 1000,
  fields: [{ field: "TotalCost", label: "total cost", present: 400 }],
  unpriced: { count: 600, models: ["my-finetune-v2"] },
};

/** Stands in for the widget frame: it publishes its queries' completeness to the card. */
function PublishingWidget({ reports }: { reports: readonly QueryCompleteness[] }) {
  usePublishWidgetCompleteness(combineCompleteness(reports));
  return <div>chart</div>;
}

describe("given a widget card with no description", () => {
  describe("when its widget reports partial data", () => {
    /** @scenario "A partial widget sends its notes to the card's info tip" */
    it("shows an (i) whose hover says what is missing and offers to add a price", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = renderWithAnalyticsHost(
        <WidgetCardShell name="Spend">
          <PublishingWidget reports={[PARTIAL]} />
        </WidgetCardShell>,
      );

      await user.hover(await screen.findByRole("button", { name: "About Spend" }));

      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveTextContent("Total cost on 400 of 1,000 traces.");
      expect(tooltip).toHaveTextContent("No price for my-finetune-v2 (600 traces).");
      await user.click(screen.getByRole("link", { name: "Add a price" }));
      expect(host.navigations).toEqual(["/settings/model-costs"]);
    });
  });

  describe("when its widget's data is complete", () => {
    it("shows an (i) that says how much the widget checked", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithAnalyticsHost(
        <WidgetCardShell name="Spend">
          <PublishingWidget
            reports={[{ state: "complete", unit: "traces", total: 1000, fields: [] }]}
          />
        </WidgetCardShell>,
      );

      await user.hover(await screen.findByRole("button", { name: "About Spend" }));

      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        "Checked 1,000 traces in this period.",
      );
    });
  });

  describe("when its widget reports nothing about its data", () => {
    it("shows no (i)", () => {
      renderWithAnalyticsHost(
        <WidgetCardShell name="Spend">
          <PublishingWidget reports={[]} />
        </WidgetCardShell>,
      );

      expect(screen.getByText("chart")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "About Spend" })).toBeNull();
    });
  });
});
