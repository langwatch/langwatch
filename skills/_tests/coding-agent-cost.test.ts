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

function savingParagraphs(rendered: string): string[] {
  return rendered.split("\n\n").filter((p) => p.startsWith("**Saving:**"));
}

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
      expect(compiled).toBe(costSkill());
    });
  });

  describe("given the rendered skill", () => {
    /** @scenario "Every recommendation names its exact settings.json key" */
    it("names the settings.json key for each recommendation", () => {
      const rendered = costSkill();
      expect(rendered).toContain('{ "model": "opus" }');
      expect(rendered).toContain('{ "autoCompactWindow": 400000 }');
      expect(rendered).toContain('{ "env": { "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet" } }');
      expect(rendered).not.toContain("subagentModel");
      expect(rendered).toContain('{ "promptCacheTtl": "1h" }');
    });

    /** @scenario "Every expected saving says whether it was measured or estimated" */
    it("labels every saving as measured or estimated", () => {
      const savings = savingParagraphs(costSkill());
      // Check 6 keeps a default and prices nothing, so six of the seven checks carry a saving.
      expect(savings).toHaveLength(6);
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

    /** @scenario "One project is narrowed with a TenantId filter in the query" */
    it("narrows to one project with a TenantId filter, not --project", () => {
      const oneProject = costSkill()
        .split("\n\n")
        .find((p) => p.includes("For one project,"));
      expect(oneProject, "the skill says how to read one project").toBeTruthy();
      expect(oneProject).toContain("add `AND TenantId = '<id>'` to every query below");
      expect(oneProject).toContain("`personal_project.id` in `langwatch whoami`");
      expect(oneProject).toContain(
        "if that field is missing, ask the user which project id to use",
      );
      expect(oneProject).not.toContain("--project");
    });
  });

  describe("given a window with no coding-session rows", () => {
    /** @scenario "The coding-agent-cost skill checks an empty window before reporting" */
    it("looks up the newest session event in any window and states its age", () => {
      const rendered = costSkill();
      expect(rendered).toContain("max(TimeUnixMs) AS newest");
      expect(rendered).toContain(
        "adding `AND TenantId = '<id>'` when the report covers one project",
      );
      expect(rendered).toContain("If the report window has no `model_call` rows");
      expect(rendered).toContain(
        "no Claude Code model call is stored for the report's scope (one project, or the whole team), so there is no cost data",
      );
      expect(rendered).toContain("events = 0");
      expect(rendered).toContain("the newest Claude Code event is from <time>, <age> ago");
    });

    /** @scenario "The coding-agent-cost skill names the Claude Code telemetry setup" */
    it("names the Claude Code OTLP environment and the project API key", () => {
      const rendered = costSkill();
      expect(rendered).toContain("CLAUDE_CODE_ENABLE_TELEMETRY");
      expect(rendered).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
      expect(rendered).toContain("OTEL_EXPORTER_OTLP_HEADERS");
    });
  });
});
