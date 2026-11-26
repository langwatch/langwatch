import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { listNativeSkills, renderSkill } from "../_compiler/native.ts";

// Backs modules/dashboard/specs/dashboards-v2.feature AC200i: what the dashboard-widgets skill
// tells Langy about a widget query's sources.

const skillsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function renderedSkill(): string {
  const skill = listNativeSkills(skillsRoot).find((s) => s.slug === "dashboard-widgets");
  if (!skill) throw new Error("dashboard-widgets is not a shipped native skill");
  return renderSkill(skill);
}

describe("the dashboard-widgets skill", () => {
  /** @scenario "AC200i Sources: the dashboard-widgets skill tells Langy about a query's sources" */
  it("names the sources, the application default, --sources, and when to add an origin", () => {
    const rendered = renderedSkill();

    expect(rendered).toContain("`{ name, sql, parameters?, sources?, projects? }`");
    expect(rendered).toContain(
      "`application`, `simulation`, `evaluation`, `sample`, `coding_agent`, `ai_tool`, `gateway`, `workflow`, `playground`, `langy` and `other`",
    );
    expect(rendered).toContain('A query that names none counts `["application"]`');
    expect(rendered).toContain("`langy` for the user's own conversations with Langy");
    expect(rendered).toContain("--sources application,langy");
    expect(rendered).not.toContain("--langy-traces");
  });
});

describe("the dashboard-widgets skill on projects and params", () => {
  /** @scenario "AC212 Skill: the dashboard-widgets skill teaches projects, the reserved names and params" */
  it("names projects, the reserved names, params, and SOURCES_IGNORED", () => {
    const rendered = renderedSkill();

    expect(rendered).toContain("`{ name, sql, parameters?, sources?, projects? }`");
    expect(rendered).toContain("{dashboard_context_sources:Array(String)}");
    expect(rendered).toContain("{dashboard_context_projects:Array(String)}");
    expect(rendered).toContain("`SOURCES_IGNORED` means the query counts every origin");
    expect(rendered).toContain("`SHARE_WINDOW_LIMITED` means");
    expect(rendered).toContain(
      'the editor says "The SQL does not read {dashboard_context_sources}"',
    );
    expect(rendered).not.toContain("This query ignores sources");
    expect(rendered).toContain("--projects A,B");
    expect(rendered).toContain("`SET param_…`");
  });
});

describe("the dashboard-widgets skill on the widget's look", () => {
  /** @scenario "AC260 Langy widgets: the skill teaches the theme's colours, never fixed ones" */
  it("names the theme's colour variables and bans fixed colours, the example included", () => {
    const rendered = renderedSkill();

    expect(rendered).toContain("var(--chakra-colors-fg)");
    expect(rendered).toContain("--chakra-colors-bg-card");
    expect(rendered).toContain("Never write a hex colour, `white` or a light background");
    const codeBlocks = rendered.match(/```jsx[\s\S]*?```/g) ?? [];
    expect(codeBlocks.length).toBeGreaterThan(0);
    for (const block of codeBlocks) {
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}\b|"white"/);
    }
  });

  /** @scenario "AC261 Langy widgets: the skill teaches a widget to fill its card" */
  it("says a widget fills its card and never sets a fixed chart height", () => {
    const rendered = renderedSkill();

    expect(rendered).toContain("about 200 px tall inside");
    expect(rendered).toContain("Never give a chart a fixed pixel height");
    expect(rendered).toContain('<ResponsiveContainer width="100%" height="100%">');
    expect(rendered).not.toMatch(/ResponsiveContainer[^>]*height=\{\d+\}/);
  });
});

describe("the dashboard-widgets skill on finding the data", () => {
  /** @scenario "AC263 Langy widgets: the skill reads one view of the schema, not all of it" */
  it("reads the schema from a file one view at a time and bounds queries by the period", () => {
    const rendered = renderedSkill();

    expect(rendered).toContain("langwatch dashboard widget schema -f json > schema.json");
    expect(rendered).toContain('select(.name == "trace_metrics")');
    expect(rendered).toContain("Write a view by its bare name, as `schema.json` gives it");
    expect(rendered).toContain("`judgments`: Instant Eval verdicts");
    expect(rendered).toContain("`evaluation_metrics`");
    expect(rendered).not.toContain("subtractDays(now(), 400) GROUP BY");
    expect(rendered).not.toContain("Seed data is stale");
    expect(rendered).not.toContain("north-star-widgets");
  });
});

describe("the dashboard-widgets skill on a broad question", () => {
  /** @scenario "AC264c Langy widgets: a broad question still ends in a widget on the board" */
  it("answers it with the numbers the traces have, and stays in the skill until the widget is on", () => {
    const rendered = renderedSkill();

    expect(rendered).toContain('A broad question ("Is our AI saving us time?"');
    expect(rendered).toContain("still ends in a widget on the board");
    expect(rendered).toContain("Stay in this skill until the widget is on the board");
  });
});
