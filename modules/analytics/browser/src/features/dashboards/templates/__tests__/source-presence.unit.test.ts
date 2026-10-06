/**
 * An empty template widget tells a quiet period from a source that was never set
 * up: its empty face asks whether the source sent data in the last 90 days, and
 * only offers the setup step when it did not.
 */

import { describe, expect, it } from "vitest";

import { BOARD_TEMPLATES } from "../index.ts";
import { statusCode } from "../model/flight-deck-chart-widgets.ts";
import { PRESENCE_DAYS, PRESENCE_SQL } from "../model/source-presence-queries.ts";
import { CALLS_TO_ACTION, type WidgetSource } from "../model/widget-calls-to-action.ts";

const SOURCES = Object.keys(CALLS_TO_ACTION) as WidgetSource[];

/** The stored TSX of the empty face alone: from its declaration to the widget's own body. */
function emptyFace(tsx: string): string {
  const start = tsx.indexOf("function CallToAction()");
  const end = tsx.indexOf("export default function Widget()");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return tsx.slice(start, end);
}

describe.each(SOURCES)("given a widget that reads %s", (source) => {
  const face = emptyFace(statusCode({ source }).tsx);
  const cta = CALLS_TO_ACTION[source];

  describe("when its source sent data, but none in the board's period", () => {
    /** @scenario "AC13 A quiet period does not ask the member to connect a source" */
    it("says there is nothing in this period, before any setup button", () => {
      const quiet = `if (present.data.length > 0) return <Note>${cta.quiet}</Note>;`;
      expect(cta.quiet).toMatch(/^No .+ in this period\.$/);
      expect(face).toContain(quiet);
      expect(face.indexOf(quiet)).toBeLessThan(face.indexOf("LW.navigate("));
    });
  });

  describe("when its source sent no data in the last 90 days", () => {
    /** @scenario "AC13b A source that was never set up shows its setup step" */
    it("shows that source's setup step and the button to its setup page", () => {
      expect(face).toContain(cta.title);
      expect(face).toContain(`LW.navigate("${cta.target}", {})`);
    });
  });

  /** @scenario "AC13c Every template widget checks its own source" */
  it("checks a window of the last 90 days and stops at the first row", () => {
    expect(PRESENCE_SQL[source]).toContain(`subtractDays(now(), ${PRESENCE_DAYS})`);
    expect(PRESENCE_SQL[source]).toMatch(/LIMIT 1$/);
  });
});

describe("given every board template", () => {
  const widgets = BOARD_TEMPLATES.flatMap(({ widgets: list }) => list);

  /** @scenario "AC13c Every template widget checks its own source" */
  it("stores the presence query each widget's empty face asks for", () => {
    for (const { name, definition } of widgets) {
      const present = definition.queries.find((query) => query.name === "present");
      expect(present, name).toBeDefined();
      expect(Object.values(PRESENCE_SQL), name).toContain(present?.sql);
    }
  });

  /** @scenario "AC13c Every template widget checks its own source" */
  it("asks for the presence query only from the empty face, never from the widget's body", () => {
    for (const { name, definition } of widgets) {
      const body = definition.code.slice(
        definition.code.indexOf("export default function Widget()"),
      );
      expect(emptyFace(definition.code), name).toContain('LW.useChartQuery("present", {})');
      expect(body, name).not.toContain('"present"');
    }
  });
});
