import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FEATURE_SKILLS, renderSkill } from "../_compiler/native.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");

// Backs specs/assistant/langy-native-skills.feature. Langy must load EXACTLY
// the published skills (the 7 on https://langwatch.ai/docs/skills/directory),
// with their content verbatim — not a mutated or recipe-expanded copy.

describe("native skill generation", () => {
  describe("given the published skill set", () => {
    it("generates exactly the published skills, with no internal recipes", () => {
      expect([...FEATURE_SKILLS].sort()).toEqual(
        ["analytics", "datasets", "evaluations", "level-up", "prompts", "scenarios", "tracing"].sort()
      );
    });

    it("has a canonical SKILL.mdx source for every listed skill", () => {
      for (const slug of FEATURE_SKILLS) {
        expect(
          fs.existsSync(path.join(skillsRoot, slug, "SKILL.mdx")),
          `missing canonical source for ${slug}`
        ).toBe(true);
      }
    });
  });

  describe("when a skill is rendered", () => {
    it("opens with opencode frontmatter carrying name and description", () => {
      for (const slug of FEATURE_SKILLS) {
        const m = renderSkill(slug).match(/^---\n([\s\S]*?)\n---\n/);
        expect(m, `${slug}: no frontmatter block`).not.toBeNull();
        expect(m![1], `${slug}: frontmatter missing name`).toMatch(/^name:\s*\S/m);
        expect(m![1], `${slug}: frontmatter missing description`).toMatch(/^description:\s*\S/m);
      }
    });

    it("inlines shared partials — no leftover MDX import or unrendered component", () => {
      for (const slug of FEATURE_SKILLS) {
        const noCode = renderSkill(slug).replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
        expect(noCode, `${slug}: leftover import`).not.toMatch(/^import\s+\w+\s+from\s+['"][^'"]+\.mdx?['"]/m);
        expect(noCode, `${slug}: unrendered component`).not.toMatch(/^<[A-Z]\w*\s*\/>\s*$/m);
        expect(noCode, `${slug}: leftover _shared ref`).not.toContain("_shared/");
      }
    });

    it("preserves the published skill content verbatim — not a stripped in-product rewrite", () => {
      // The content is the published skill (the in-product nuance — credentials
      // already provisioned — lives in AGENTS.md, not in mutated skill bodies).
      const tracing = renderSkill("tracing");
      expect(tracing).toContain("Add LangWatch Tracing to Your Code");
      expect(tracing).toContain("langwatch trace search");
    });
  });
});
