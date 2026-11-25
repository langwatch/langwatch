/**
 * "Add a widget" lists every built widget once, most asked-about first, tagged by its branch of
 * the question tree. Widgets without code, retired widgets and coding-agent widgets are left out
 * of "All"; the coding-agent ones are under their own chip.
 */

import { describe, expect, it } from "vitest";

import {
  CATALOGUE_WIDGETS,
  CODING_PICKER_QUESTIONS,
  CODING_PICKER_RANKING,
  IMPLEMENTED_WIDGET_IDS,
  implementedWidget,
  PICKER_QUESTIONS,
  PICKER_RANKING,
  PICKER_SECTIONS,
  pickerPool,
  pickerSections,
  pickerWidgets,
  QUESTION_TREE,
  RETIRED_PICKER_WIDGETS,
} from "../index.ts";

const listed = PICKER_SECTIONS.flatMap(({ questions }) => questions);
const listedIds = new Set(listed.map(({ id }) => id));
const widgetById = new Map(CATALOGUE_WIDGETS.map((widget) => [widget.id, widget] as const));
const built = new Set(IMPLEMENTED_WIDGET_IDS);
const isCoding = (id: string) => {
  const widget = widgetById.get(id)!;
  return (
    widget.agentKinds.includes("coding") ||
    widget.requirements.some((keys) => keys.includes("coding"))
  );
};
const offered = (id: string) => built.has(id) && !isCoding(id) && !RETIRED_PICKER_WIDGETS.has(id);

/** Words a member with no LangWatch knowledge would not read on a card. */
const JARGON =
  /\b(traces?|spans?|buckets?|p95|p99|percentiles?|evaluators?|judges?|metadata|LWQL|LangWatchQL)\b/i;

describe("given the catalogue picker", () => {
  /** @scenario "AC17 Only what is built is offered" */
  it("lists every built widget once, and none without code", () => {
    expect(listed.length).toBe(listedIds.size);
    for (const { id } of CATALOGUE_WIDGETS) expect(listedIds.has(id), id).toBe(offered(id));
  });

  /** @scenario "AC16 The picker offers every catalogue widget that has code, most asked-about first" */
  it("ranks every offered widget, most asked-about first, with the categories mixed", () => {
    const ranked = PICKER_RANKING.filter((id) => listedIds.has(id));
    expect(PICKER_QUESTIONS.map(({ id }) => id)).toEqual(ranked);
    expect(PICKER_QUESTIONS[0]?.id).toBe("ck-kpis");
    expect(PICKER_QUESTIONS[0]?.question).toBe("Is my agent doing its job?");
    const firstTrunks = new Set(PICKER_QUESTIONS.slice(0, 5).map(({ trunk }) => trunk));
    expect(firstTrunks.size).toBeGreaterThan(1);
  });

  /** @scenario "AC16 The picker offers every catalogue widget that has code, most asked-about first" */
  it("files each widget under its question's branch, which its row's tag names", () => {
    const branchOf = new Map(QUESTION_TREE.map(({ id, branch }) => [id, branch] as const));
    for (const { id, branch, question } of PICKER_QUESTIONS) {
      const widget = widgetById.get(id);
      expect(branch.title, id).toBe(branchOf.get(widget?.questionId ?? ""));
      expect(question, id).toBe(widget?.question);
    }
  });

  /** @scenario "AC134 Picker filters: a category lists its branches as sections, the best-ranked first" */
  it("puts a category's branches in sections, the one with the best-ranked widget first", () => {
    const protect = PICKER_QUESTIONS.filter(({ trunk }) => trunk === "Protect");
    const sections = pickerSections({ questions: protect });
    expect(sections[0]?.questions[0]?.id).toBe(protect[0]?.id);
    const firsts = sections.map(({ questions }) => protect.indexOf(questions[0]!));
    expect(firsts).toEqual(firsts.toSorted((a, b) => a - b));
    for (const { questions } of sections) {
      const positions = questions.map((question) => protect.indexOf(question));
      expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    }
  });

  /** @scenario "AC18 Every widget and template carries a default Langy prompt" */
  it("drafts every widget with a prompt that asks its question over the dashboard period", () => {
    for (const { id, question, prompt } of [...listed, ...CODING_PICKER_QUESTIONS]) {
      expect(prompt.startsWith(question), id).toBe(true);
      expect(prompt, id).toContain("dashboard period");
    }
  });

  /** @scenario "AC139 Picker copy: a widget is named by its question in plain words" */
  it("names each offered widget by its question, in words with no LangWatch jargon", () => {
    for (const { id, question, why, prompt } of [...PICKER_QUESTIONS, ...CODING_PICKER_QUESTIONS]) {
      expect(question.endsWith("?"), id).toBe(true);
      expect(question, id).not.toMatch(JARGON);
      expect(why, id).not.toMatch(JARGON);
      expect(prompt.startsWith(question), id).toBe(true);
    }
  });

  /** @scenario "AC139b Picker copy: a retired widget is not offered, and saved boards still draw it" */
  it("does not offer a retired widget under any chip, but still draws it on a saved board", () => {
    expect(RETIRED_PICKER_WIDGETS.has("conversation-length")).toBe(true);
    for (const agentKind of [void 0, "support-bot", "coding"] as const) {
      const pool = pickerPool(agentKind ? { agentKind } : {});
      expect(pool.some(({ id }) => id === "conversation-length")).toBe(false);
    }
    expect(implementedWidget("conversation-length")?.definition.code).toBeTruthy();
  });

  /** @scenario "AC16 The picker offers every catalogue widget that has code, most asked-about first" */
  it("stores a picked widget under the question it answers", () => {
    for (const { id, question } of listed) {
      const [stored, ...rest] = pickerWidgets(id);
      expect(rest, id).toEqual([]);
      expect(stored?.name, id).toBe(question);
    }
    expect(() => pickerWidgets("not-a-widget")).toThrow(/not-a-widget/);
  });

  /** @scenario "AC138 Picker filters: a row names the agent types its widget is made for" */
  it("names up to three agent kinds a widget is made for, and none for a general one", () => {
    for (const { id, madeFor } of PICKER_QUESTIONS) {
      const kinds = widgetById.get(id)!.agentKinds;
      expect(madeFor, id).toEqual(kinds.length <= 3 ? kinds : []);
    }
    expect(PICKER_QUESTIONS.some(({ madeFor }) => madeFor.length > 0)).toBe(true);
  });

  /** @scenario "AC131 Picker filters: chips narrow the widgets by category and agent type" */
  it("offers only the widgets made for a picked agent type", () => {
    expect(pickerPool({})).toBe(PICKER_QUESTIONS);
    const voice = pickerPool({ agentKind: "voice" });
    expect(voice.length).toBeGreaterThan(0);
    expect(voice.every(({ madeFor }) => madeFor.includes("voice"))).toBe(true);
    expect(voice.length).toBe(
      PICKER_QUESTIONS.filter(({ madeFor }) => madeFor.includes("voice")).length,
    );
  });
});

describe("given the coding-agent widgets", () => {
  /** @scenario "Finder: Add a widget offers coding-agent widgets only under the Coding agent chip" */
  it("leaves every widget made for coding agents or reading their traces out of All", () => {
    const coding = CATALOGUE_WIDGETS.filter(({ id }) => built.has(id) && isCoding(id));
    expect(coding.length).toBeGreaterThan(0);
    for (const { id } of coding) expect(listedIds.has(id), id).toBe(false);
  });

  /** @scenario "Finder: Add a widget offers coding-agent widgets only under the Coding agent chip" */
  it("lists the built ones under the Coding agent chip, in the coding agents area's order", () => {
    expect(pickerPool({ agentKind: "coding" })).toBe(CODING_PICKER_QUESTIONS);
    const ids = CODING_PICKER_QUESTIONS.map(({ id }) => id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(CODING_PICKER_RANKING.filter((id) => built.has(id)));
    expect(CODING_PICKER_RANKING[0]).toBe("me-burn-summary");
    for (const id of CODING_PICKER_RANKING) expect(isCoding(id), id).toBe(true);
  });
});
