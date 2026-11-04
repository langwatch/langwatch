/**
 * A widget naming a project its viewer cannot read draws the no-access state, naming no project.
 * @see modules/dashboard/specs/dashboards-v2.feature AC208
 */
import { describe, expect, it } from "vitest";

import { withheldWords } from "../widget-access.ts";
import { widgetFace, type WidgetQueryRecords } from "../widget-completeness.ts";

const refused: WidgetQueryRecords = {
  main: {
    completeness: null,
    hasResult: false,
    failure: {
      attempts: 1,
      error: {
        code: "project_not_found",
        title: "Project not found",
        message: "Project not found",
      },
    },
  },
  other: { completeness: null, hasResult: true },
};

describe("given a query the server refused with project_not_found", () => {
  /** @scenario "AC208 Project: a widget naming a project the viewer cannot read draws the no-access state, on that card only" */
  it("draws the no-access face, in words that never name the project", () => {
    const face = widgetFace(refused);

    expect(face.kind).toBe("no_access");
    const words = withheldWords({
      missingGates: face.kind === "no_access" ? face.missingGates : [],
      projectName: "Checkout Agent",
    });
    expect(words.what).toBe("You can't read a project this widget uses");
    expect(JSON.stringify(words)).not.toMatch(/Checkout|project_|[0-9]/);
  });

  /** @scenario "AC208 Project: a widget naming a project the viewer cannot read draws the no-access state, on that card only" */
  it("leaves a widget whose queries all answered as a chart", () => {
    expect(widgetFace({ main: { completeness: null, hasResult: true } }).kind).toBe("chart");
  });
});
