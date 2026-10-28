import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { listNativeSkills, renderSkill } from "../_compiler/native.ts";

// Backs modules/dashboard/specs/dashboards-v2.feature AC200i: what the dashboard-widgets skill
// tells Langy about a widget's "Langy traces" setting.

const skillsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function renderedSkill(): string {
  const skill = listNativeSkills(skillsRoot).find((s) => s.slug === "dashboard-widgets");
  if (!skill) throw new Error("dashboard-widgets is not a shipped native skill");
  return renderSkill(skill);
}

describe("the dashboard-widgets skill", () => {
  /** @scenario "AC200i Langy setting: Langy writes the setting with the widgets it builds" */
  it("tells Langy to set a widget's Langy traces setting when it adds or updates one", () => {
    const rendered = renderedSkill();

    expect(rendered).toContain("### Langy traces");
    expect(rendered).toContain("`--langy-traces left-out`: the widget counts");
    expect(rendered).toContain("Leaving it out on `update` keeps the widget's stored setting");
    expect(rendered).toContain("`--langy-traces included`");
    expect(rendered).toContain("Always use it when the widget reads Langy's own traces");
    expect(rendered).toContain("`TraceName = 'langy.turn'`");
    expect(rendered).toContain("keep it unless the widget reads Langy's own traces");
    expect(rendered).toContain("--queries-file queries.json --langy-traces left-out");
  });
});
