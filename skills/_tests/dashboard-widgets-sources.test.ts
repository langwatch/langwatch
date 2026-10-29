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
  it("names projects, the reserved names, params, and followsSources before sources", () => {
    const rendered = renderedSkill();

    expect(rendered).toContain("`{ name, sql, parameters?, sources?, projects? }`");
    expect(rendered).toContain("{dashboard_context_sources:Array(String)}");
    expect(rendered).toContain("{dashboard_context_projects:Array(String)}");
    expect(rendered).toContain("read `params.followsSources` before `params.sources`");
    expect(rendered).toContain("--projects A,B");
    expect(rendered).toContain("`SET param_…`");
  });
});
