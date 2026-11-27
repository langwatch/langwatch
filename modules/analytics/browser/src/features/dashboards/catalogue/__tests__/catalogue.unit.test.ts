/**
 * The catalogue holds together: widgets answer tree questions on one branch of one trunk,
 * templates list only catalogue widgets and adapt to the agent kind, each area lists its own
 * templates, and the boards a project starts with never show the same widget twice.
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_KINDS,
  CATALOGUE_TEMPLATES,
  CATALOGUE_WIDGETS,
  DATA_REQUIREMENTS,
  focusTemplateId,
  preloadedTemplatesFor,
  QUESTION_BRANCHES,
  QUESTION_TREE,
  TEMPLATE_VARIANTS,
  templateForKind,
  templatesInArea,
  TRUNKS,
} from "../index.ts";

const QUESTION_IDS = new Set(QUESTION_TREE.map(({ id }) => id));
const WIDGET_IDS = new Set(CATALOGUE_WIDGETS.map(({ id }) => id));
const REQUIREMENT_KEYS = new Set(DATA_REQUIREMENTS.map(({ key }) => key));
const APPLICATION_KINDS = AGENT_KINDS.filter((kind) => kind !== "coding");
const byId = new Map(CATALOGUE_TEMPLATES.map((template) => [template.id, template]));

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
      for (const id of template.widgets) expect(WIDGET_IDS, template.id).toContain(id);
      expect(new Set(template.widgets).size, template.id).toBe(template.widgets.length);
    }
  });

  /** @scenario "Finder: categories are the verbs Grow, Protect, Profit and Trust" */
  it("files every question under a branch, and every branch under a trunk, in trunk order", () => {
    expect(TRUNKS).toEqual(["Grow", "Protect", "Profit", "Trust"]);
    const branchTitles = new Set(QUESTION_BRANCHES.map(({ title }) => title));
    for (const { id, branch } of QUESTION_TREE) expect(branchTitles, id).toContain(branch);
    const trunkOrder = QUESTION_BRANCHES.map(({ trunk }) => TRUNKS.indexOf(trunk));
    expect(trunkOrder).toEqual(trunkOrder.toSorted((a, b) => a - b));
    for (const { id, trunk } of CATALOGUE_TEMPLATES) expect(TRUNKS, id).toContain(trunk);
  });

  describe.each(AGENT_KINDS)("when a %s project gets its preloaded boards", (kind) => {
    /** @scenario "AC15b A project's preloaded boards never repeat a widget" */
    it("shows each widget on at most one of them", () => {
      const boards = preloadedTemplatesFor({ kind });
      const widgets = boards.flatMap(({ widgets }) => widgets);
      expect(boards.length).toBeGreaterThan(0);
      expect(new Set(widgets).size).toBe(widgets.length);
    });
  });

  /** @scenario "AC15c The prototype's boards are the starter set, under the My agent at a glance name" */
  it("names the one default template My agent at a glance and preloads it for application agents", () => {
    const [health, ...others] = CATALOGUE_TEMPLATES.filter(({ isDefault }) => isDefault);
    const forKind = APPLICATION_KINDS.map((kind) =>
      preloadedTemplatesFor({ kind }).find(({ id }) => id.startsWith("cockpit")),
    );
    expect(others).toEqual([]);
    expect(health?.name).toBe("My agent at a glance");
    expect(health?.formerNames).toEqual(["Agent health"]);
    expect(health?.origin).toBe("prototype");
    expect(forKind.every((template) => template !== void 0)).toBe(true);
  });

  /** @scenario "AC15c The prototype's boards are the starter set, under the My agent at a glance name" */
  it("preloads the six personal boards for coding agents, and the library's templates for no one", () => {
    expect(preloadedTemplatesFor({ kind: "coding" })).toHaveLength(6);
    for (const template of CATALOGUE_TEMPLATES.filter(({ origin }) => origin === "library")) {
      expect(template.preloadFor, template.id).toEqual([]);
    }
  });
});

describe("given a template with its own widget list for some agent kinds", () => {
  const release = byId.get("release")!;
  const ragId = focusTemplateId({ baseId: "release", kind: "rag" });
  const rag = templateForKind({ template: release, kind: "rag" });

  /** @scenario "Finder: a template adapts to the agent kind instead of listing a copy per kind" */
  it("lists the template once, and adapts it to the kind under its own name", () => {
    const ids = CATALOGUE_TEMPLATES.map(({ id }) => id);
    expect(ids).toContain("release");
    expect(ids.some((id) => id.includes("__"))).toBe(false);
    expect(release.focusKind).toBeUndefined();
    expect(rag).toMatchObject({
      id: ragId,
      name: release.name,
      trunk: release.trunk,
      job: release.job,
      focusKind: "rag",
      isDefault: false,
    });
    expect(rag.widgets).toContain("rag-dataset-versions");
    expect(release.widgets).not.toContain("rag-dataset-versions");
    expect(templateForKind({ template: release, kind: "coding" })).toBe(release);
    expect(TEMPLATE_VARIANTS.map(({ id }) => id)).toContain(ragId);
  });

  /** @scenario "AC145b Template card: a board made under a template's former name still counts as added" */
  it("keeps the former focus template's name, so a board made from it counts as the variant", () => {
    expect(rag.formerNames).toEqual(expect.arrayContaining(["Release check: RAG focus"]));
    expect(rag.formerNames).toEqual(expect.arrayContaining([...release.formerNames]));
  });

  /** @scenario "Finder: a template adapts to the agent kind instead of listing a copy per kind" */
  it("asks for a report on the adapted template's own widgets", () => {
    expect(rag.reportPrompt).toContain(`"${release.name}"`);
    for (const id of rag.widgets) {
      const question = CATALOGUE_WIDGETS.find((widget) => widget.id === id)?.question ?? "";
      expect(rag.reportPrompt, id).toContain(question);
    }
  });

  /** @scenario "Finder: a template adapts to the agent kind instead of listing a copy per kind" */
  it("preloads the adapted template where the template is preloaded for that kind", () => {
    const ids = preloadedTemplatesFor({ kind: "rag" }).map(({ id }) => id);
    expect(ids).toContain(ragId);
    expect(ids).not.toContain("release");
  });

  /** @scenario "Finder: a template adapts to the agent kind instead of listing a copy per kind" */
  it("makes a template preloaded for one agent kind made for that kind", () => {
    expect(byId.get("calls")?.focusKind).toBe("voice");
    expect(byId.get("costs")?.focusKind).toBeUndefined();
  });
});

describe("given the template areas", () => {
  /** @scenario "Finder: each area lists its own templates, most needed first" */
  it("starts each area with the template its members need most", () => {
    const names = (area: "llmops" | "org" | "coding") =>
      templatesInArea({ area }).map(({ name }) => name);
    expect(names("llmops").slice(0, 3)).toEqual([
      "My agent at a glance",
      "Answer quality",
      "Did my last change break anything?",
    ]);
    expect(names("coding")[0]).toBe("Where did my tokens go?");
    expect(templatesInArea({ area: "org" }).every(({ scope }) => scope === "org")).toBe(true);
    expect(templatesInArea({ area: "org" }).length).toBeGreaterThan(0);
    expect(templatesInArea({ area: "llmops" })).toHaveLength(21);
  });
});
