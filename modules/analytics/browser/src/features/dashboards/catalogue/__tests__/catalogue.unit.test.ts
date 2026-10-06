/**
 * The catalogue holds together: every widget answers a tree question with known
 * data requirements, templates list only catalogue widgets, and the boards a
 * project starts with never show the same widget twice.
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_KINDS,
  CATALOGUE_TEMPLATES,
  CATALOGUE_WIDGETS,
  DATA_REQUIREMENTS,
  preloadedTemplatesFor,
  QUESTION_TREE,
  templateWidgetsFor,
} from "../index.ts";

const QUESTION_IDS = new Set(QUESTION_TREE.map(({ id }) => id));
const WIDGET_IDS = new Set(CATALOGUE_WIDGETS.map(({ id }) => id));
const REQUIREMENT_KEYS = new Set(DATA_REQUIREMENTS.map(({ key }) => key));
const APPLICATION_KINDS = AGENT_KINDS.filter((kind) => kind !== "coding");

describe("given the dashboards catalogue", () => {
  /** @scenario "AC15 Every widget answers a question from the question tree" */
  it("ties every widget to tree questions and known data requirements", () => {
    expect(WIDGET_IDS.size).toBe(CATALOGUE_WIDGETS.length);
    for (const widget of CATALOGUE_WIDGETS) {
      expect(QUESTION_IDS, widget.id).toContain(widget.questionId);
      for (const also of widget.alsoAnswers) expect(QUESTION_IDS, widget.id).toContain(also);
      for (const keys of widget.requirements) {
        for (const key of keys) expect(REQUIREMENT_KEYS, widget.id).toContain(key);
      }
    }
  });

  /** @scenario "AC15 Every widget answers a question from the question tree" */
  it("lists only catalogue widgets on each template, none of them twice", () => {
    for (const template of CATALOGUE_TEMPLATES) {
      for (const list of [template.widgets, ...Object.values(template.byAgentKind)]) {
        for (const id of list) expect(WIDGET_IDS, template.id).toContain(id);
        expect(new Set(list).size, template.id).toBe(list.length);
      }
    }
  });

  describe.each(AGENT_KINDS)("when a %s project gets its preloaded boards", (kind) => {
    /** @scenario "AC15b A project's preloaded boards never repeat a widget" */
    it("shows each widget on at most one of them", () => {
      const boards = preloadedTemplatesFor({ kind });
      const widgets = boards.flatMap((template) => templateWidgetsFor({ template, kind }));
      expect(boards.length).toBeGreaterThan(0);
      expect(new Set(widgets).size).toBe(widgets.length);
    });
  });

  /** @scenario "AC15c The prototype's boards are the starter set, under the Agent Flight Deck name" */
  it("preloads the Agent Flight Deck for every application agent kind", () => {
    const [flightDeck, ...others] = CATALOGUE_TEMPLATES.filter(({ isDefault }) => isDefault);
    expect(others).toEqual([]);
    expect(flightDeck?.name).toBe("Agent Flight Deck");
    expect(flightDeck?.origin).toBe("prototype");
    expect((flightDeck?.preloadFor ?? []).toSorted()).toEqual(APPLICATION_KINDS.toSorted());
  });

  /** @scenario "AC15c The prototype's boards are the starter set, under the Agent Flight Deck name" */
  it("preloads the six personal boards for coding agents, and the library's templates for no one", () => {
    expect(preloadedTemplatesFor({ kind: "coding" })).toHaveLength(6);
    for (const template of CATALOGUE_TEMPLATES.filter(({ origin }) => origin === "library")) {
      expect(template.preloadFor, template.id).toEqual([]);
    }
  });
});
