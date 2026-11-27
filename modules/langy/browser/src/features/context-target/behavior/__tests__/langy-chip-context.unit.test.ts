/**
 * What a context chip says it hands Langy, as the composer's context list shows it.
 * @see modules/dashboard/specs/dashboards-v2.feature AC126b
 */

import { describe, expect, it } from "vitest";

import { describeChipContext } from "../langy-chip-context.ts";

describe("describeChipContext", () => {
  /** @scenario "AC126b Langy context: the open board is listed once, and a widget says what Langy reads" */
  it("says a widget hands over its data and queries, and a board the board", () => {
    const widget = describeChipContext({
      id: 'dashboard:widget "Traffic"',
      kind: "dashboard",
      label: "widget: Traffic",
      ref: 'widget "Traffic"',
    });
    const board = describeChipContext({
      id: "dashboard:board-1",
      kind: "dashboard",
      label: "dashboard: My dashboard · 30d · 1d",
      ref: 'dashboard "My dashboard" (id board-1)',
    });

    expect(widget.action).toBe("Langy will read this widget's data and queries.");
    expect(board.action).toBe("Langy will read this dashboard.");
  });
});
