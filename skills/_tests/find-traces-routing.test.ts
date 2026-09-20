import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { listNativeSkills, renderSkill } from "../_compiler/native.js";

// Backs specs/langy/langy-trace-explorer-actions.feature ("The skill decides
// between driving the Explorer and answering with cards"): what the
// find-traces skill tells Langy, and how Langy's routing table reaches it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(skillsRoot, "..");

function renderedSkill(): string {
  const skill = listNativeSkills(skillsRoot).find(
    (s) => s.slug === "find-traces",
  );
  if (!skill) throw new Error("find-traces is not a shipped native skill");
  return renderSkill(skill);
}

/** The text of one `## ` section, heading included. */
function sectionOf(rendered: string, heading: string): string {
  const start = rendered.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`no section "${heading}"`);
  const next = rendered.indexOf("\n## ", start + 1);
  return rendered.slice(start, next < 0 ? undefined : next);
}

describe("the find-traces skill", () => {
  describe("given its section on the two ways of working", () => {
    /** @scenario "The skill states the primary and the secondary way of working" */
    it("drives the Explorer when finding traces is the ask, and stays on the page otherwise", () => {
      const section = sectionOf(
        renderedSkill(),
        "Primary and secondary way of working",
      );
      const primary = section.slice(
        section.indexOf("**Primary"),
        section.indexOf("**Secondary"),
      );
      const secondary = section.slice(section.indexOf("**Secondary"));

      expect(primary).toContain("finding traces is the ask");
      expect(primary).toContain("open the Trace Explorer");
      expect(primary).toContain("explorer.setTimeRange");
      expect(primary).toContain("explorer.setFilter");

      expect(secondary).toContain("traces are a means to another task");
      expect(secondary).toContain("Stay on the page");
      expect(secondary).toContain("langwatch trace search");
      expect(secondary).toContain("View in Trace Explorer");
    });
  });

  describe("given its section on defaults", () => {
    /** @scenario "The skill takes the window and the filter from the page" */
    it("searches with the page's window and filter, and names no origin", () => {
      const section = sectionOf(
        renderedSkill(),
        "Step 1: Take the window and the filter from the page",
      );
      expect(section).toContain("--start-date <from> --end-date <to>");
      expect(section).toContain("Keep the filter the user already applied");
      expect(section).toContain("Do not pass `--origin application`");

      // No command the skill shows adds the origin it tells Langy to leave out.
      const commands = renderedSkill()
        .split("\n")
        .filter((line) => line.startsWith("langwatch "));
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command).not.toContain("--origin");
      }
    });
  });

  describe("given its section on searching", () => {
    /** @scenario "The skill searches every form a concept can take before saying nothing was found" */
    it("reads the reference, lists values, names each form of feedback and widens the window", () => {
      const rendered = renderedSkill();
      const reference = rendered.indexOf(
        "langwatch query reference --section trace-filter",
      );
      const forms = rendered.indexOf("## Step 3");
      expect(reference).toBeGreaterThan(0);
      expect(reference, "the reference comes before the search").toBeLessThan(
        forms,
      );
      expect(rendered).toContain("langwatch trace facets <field>");

      const section = sectionOf(
        rendered,
        "Step 3: Search every form the concept can take",
      );
      expect(section).toContain("**Events.**");
      expect(section).toContain(
        "event:thumbs_up_down AND event.attribute.event.metrics.vote:-1",
      );
      expect(section).toContain("**Annotations.**");
      expect(section).toContain("**Evaluator results.**");
      expect(section).toContain("**A wider window.**");
      expect(section).toContain("Before reporting that nothing was found");
    });
  });
});

describe("Langy's routing table", () => {
  /** @scenario "The routing table sends trace-finding asks to the find-traces skill" */
  it("routes trace-finding asks to find-traces, primary and secondary, and ships the skill as rendered", () => {
    const agentsMd = fs.readFileSync(
      path.join(
        repoRoot,
        "services",
        "langyagent",
        "internal",
        "assets",
        "AGENTS.md",
      ),
      "utf8",
    );
    const rows = agentsMd
      .split("\n")
      .filter((row) => row.startsWith("|"))
      .map((row) => row.split("|").map((cell) => cell.trim()))
      .filter((cells) => cells[2] === "`find-traces`");

    expect(rows).toHaveLength(2);
    const [primary, secondary] = rows;
    expect(primary![1]).toContain("Primary");
    expect(primary![1]).toContain("find the traces where");
    expect(primary![3]).toContain("langwatch ui call explorer.setFilter");
    expect(secondary![1]).toContain("Secondary");
    expect(secondary![3]).toContain("langwatch trace search --filter");
    expect(agentsMd).not.toContain("trace search --errors-only --origin");

    const rendered = renderedSkill();
    const committed = fs.readFileSync(
      path.join(skillsRoot, "_compiled", "native", "find-traces", "SKILL.md"),
      "utf8",
    );
    const mirrored = fs.readFileSync(
      path.join(
        repoRoot,
        "services",
        "langyagent",
        "internal",
        "assets",
        "skills",
        "find-traces",
        "SKILL.md",
      ),
      "utf8",
    );
    expect(committed).toBe(rendered);
    expect(mirrored).toBe(committed);
  });
});
