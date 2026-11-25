/**
 * A request or session that hit no error is not a success: only a sent outcome, the conversation
 * outcome judge or a test verdict says a task went right. A widget that counts errors alone
 * names what it counts, and the cost card offers to score how conversations end.
 * @see modules/dashboard/specs/dashboards-v2.feature AC248
 */

import { describe, expect, it } from "vitest";

import { PRESENCE_QUERY } from "../../model/sources-parameter.ts";
import { BOARD_TEMPLATES } from "../../templates/index.ts";
import { COST_EFFICIENCY_CODE } from "../../templates/model/flight-deck-table-widgets.ts";
import { CATALOGUE_WIDGETS, IMPLEMENTED_WIDGET_IDS, implementedWidget } from "../index.ts";
import { CATALOGUE_WIDGET_ACTIONS } from "../model/catalogue-widget-actions.ts";

const SUCCESS = /\bsucce(?:ss|ssful|ssfully|ssive|ed|eds|eded)\b/i;
const ERRORS_ONLY = /\bHasError\b|\bApiErrors\b|\bInternalErrors\b|\bRetriesExhausted\b/;
const REAL_OUTCOME = /\bMetadataOutcome\b|\bVerdict\b|\bLabel\b|\boutcome\b/i;

const built = [
  ...IMPLEMENTED_WIDGET_IDS.flatMap((id) => implementedWidget(id) ?? []),
  ...BOARD_TEMPLATES.flatMap((template) => template.widgets),
];

/** Widgets whose queries tell good from bad only by whether a request hit an error. */
const errorsOnly = built.filter(({ definition }) => {
  const sql = definition.queries
    .filter(({ name }) => name !== PRESENCE_QUERY)
    .map(({ sql }) => sql)
    .join("\n");
  return ERRORS_ONLY.test(sql) && !REAL_OUTCOME.test(sql);
});

const catalogueById = new Map(CATALOGUE_WIDGETS.map((widget) => [widget.id, widget]));

describe("given every stock widget that counts errors alone", () => {
  /** @scenario "AC248 Widget words: a card never calls requests without an error a success" */
  it("finds the status, cost and coding agent widgets among them", () => {
    const keys = new Set(errorsOnly.map(({ key }) => key));

    expect(
      ["ck-status", "fd-cost-efficiency", "fd-coding-agents"].filter((k) => !keys.has(k)),
    ).toEqual([]);
  });

  /** @scenario "AC248 Widget words: a card never calls requests without an error a success" */
  it("never says success in its title, info tip, card code or Langy prompts", () => {
    const leaks = errorsOnly.flatMap(({ key, name, definition }) => {
      const widget = catalogueById.get(key);
      const actions = CATALOGUE_WIDGET_ACTIONS[key] ?? [];
      const texts = [
        name,
        definition.description ?? "",
        definition.code,
        definition.prompt ?? "",
        widget?.title ?? "",
        widget?.why ?? "",
        widget?.prompt ?? "",
        ...actions.map((action) => action.prompt),
      ];
      return texts
        .filter((text) => SUCCESS.test(text))
        .map((text) => `${key}: ${text.slice(0, 80)}`);
    });

    expect(leaks).toEqual([]);
  });

  /** @scenario "AC248 Widget words: a card never calls requests without an error a success" */
  it("asks Langy for the share of requests without an error on the status card", () => {
    const status = catalogueById.get("ck-status");

    expect(status?.prompt).toContain("without an error");
    expect(status?.prompt).not.toMatch(SUCCESS);
  });
});

describe("given every catalogue prompt", () => {
  /** @scenario "AC248 Widget words: a card never calls requests without an error a success" */
  it("never pairs success with HasError", () => {
    const paired = CATALOGUE_WIDGETS.filter(
      ({ prompt }) => SUCCESS.test(prompt) && /\bHasError\b/.test(prompt),
    ).map(({ id }) => id);

    expect(paired).toEqual([]);
  });
});

describe("given the cost per request without an error card", () => {
  /** @scenario "AC248b Widget words: a cost card with only errors to go on offers to score how conversations end" */
  it("says it can't tell which answers were right and offers to score how conversations end", () => {
    const code = COST_EFFICIENCY_CODE.tsx;

    expect(code).toContain('label="Cost per request without an error"');
    expect(code).toContain("Can't tell which answers were right yet.");
    expect(code).toContain('LW.navigate("onlineEvaluations", {})');
    expect(code).toContain("Score how conversations end");
    expect(code).toContain("canAskLangy() ? (");
    expect(code).toContain("askLangy(OUTCOME)");
    expect(
      CATALOGUE_WIDGET_ACTIONS["fd-cost-efficiency"]?.some(
        (action) => action.kind === "click" && action.on === "outcome",
      ),
    ).toBe(true);
  });
});
