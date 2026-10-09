import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { listNativeSkills, listPublishedSkills, renderSkill } from "../_compiler/native.ts";

// Backs specs/skills/coding-agent-cost.feature: the recommendations, their
// settings and their saving labels are what users act on, so they are pinned
// here rather than left to a model's reading of the skill.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");

function costSkill(): string {
  const skill = listNativeSkills(skillsRoot).find((s) => s.slug === "coding-agent-cost");
  expect(skill, "coding-agent-cost is a shipped skill").toBeTruthy();
  return renderSkill(skill!);
}

/** The paragraphs that start with the bold "Saving:" label. */
function savingParagraphs(rendered: string): string[] {
  return rendered.split("\n\n").filter((p) => p.startsWith("**Saving:**"));
}

/** The body of every ```sql fence. */
function sqlBlocks(rendered: string): string[] {
  return [...rendered.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

describe("the coding-agent-cost skill", () => {
  describe("given the published skill set", () => {
    /** @scenario "The skill is published and ships to Langy" */
    it("publishes the skill and keeps the compiled Langy copy in step", () => {
      const published = listPublishedSkills(skillsRoot).find((s) => s.slug === "coding-agent-cost");
      expect(published?.isRecipe).toBe(false);

      const compiled = fs.readFileSync(
        path.join(skillsRoot, "_compiled", "native", "coding-agent-cost", "SKILL.md"),
        "utf8",
      );
      expect(compiled).toContain("# Cut Your Coding Agent's Cost and Context");
      expect(compiled).toContain('"promptCacheTtl": "1h"');
    });
  });

  describe("given the rendered skill", () => {
    /** @scenario "Every recommendation names its exact settings.json key" */
    it("names the settings.json key for each recommendation", () => {
      const rendered = costSkill();
      expect(rendered).toContain('{ "model": "opus" }');
      expect(rendered).toContain('{ "autoCompactWindow": 400000 }');
      expect(rendered).toContain('{ "subagentModel": "sonnet" }');
      expect(rendered).toContain('{ "promptCacheTtl": "1h" }');
    });

    /** @scenario "Every expected saving says whether it was measured or estimated" */
    it("labels every saving as measured or estimated", () => {
      const savings = savingParagraphs(costSkill());
      expect(savings.length).toBeGreaterThanOrEqual(6);
      for (const paragraph of savings) {
        expect(paragraph, paragraph.slice(0, 80)).toMatch(/\b(measured|estimated)\b/i);
      }
    });

    /** @scenario "Subscription users hear about usage, API-key users about cash" */
    it("words subscription savings as usage and keeps their one-hour main cache", () => {
      const rendered = costSkill();
      expect(rendered).toContain(
        "A saving means more work before the plan's usage limits, not cash",
      );
      expect(rendered).toContain("API-equivalent");
      expect(rendered).toContain(
        "Do NOT recommend a five-minute main cache to a subscription user",
      );
    });

    /** @scenario "Settings go in settings.json, never in a shell export" */
    it("warns against shell exports and reads only the coding agent views", () => {
      const rendered = costSkill();
      expect(rendered).toContain("Do NOT set any of these as a shell `export`");
      expect(rendered).toContain("langwatch query run");

      const queries = sqlBlocks(rendered);
      expect(queries.length).toBeGreaterThanOrEqual(4);
      for (const query of queries) {
        expect(query).toContain("langwatch.coding_session_events");
        expect(query).toContain("TimeUnixMs >= now() - INTERVAL 30 DAY");
      }
    });
  });
});
