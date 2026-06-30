import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { listPublishedSkills, renderSkill } from "../_compiler/native.js";
import { FEATURE_SKILLS } from "../_lib/feature-skills.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const skills = listPublishedSkills(skillsRoot);

// Backs specs/langy/langy-native-skills.feature. Langy must load EXACTLY the
// published skills — the curated feature skills plus every recipe — with their
// content verbatim. Driving generation off listPublishedSkills (the same
// selection the publisher uses) is what makes "what we publish, Langy has" true.

describe("native skill generation", () => {
  describe("given the published skill set", () => {
    it("includes every curated feature skill", () => {
      const slugs = skills.map((s) => s.slug);
      for (const f of FEATURE_SKILLS) expect(slugs, `missing feature skill: ${f}`).toContain(f);
    });

    it("includes every recipe on disk — what we publish, Langy has", () => {
      const recipeDirs = fs
        .readdirSync(path.join(skillsRoot, "recipes"), { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsRoot, "recipes", e.name, "SKILL.mdx")))
        .map((e) => e.name)
        .sort();
      const recipeSlugs = skills.filter((s) => s.isRecipe).map((s) => s.slug).sort();
      expect(recipeSlugs).toEqual(recipeDirs);
      expect(recipeSlugs.length, "expected recipes to be included").toBeGreaterThan(0);
    });

    it("uses unique opencode-valid slugs (recipes flattened, no collisions)", () => {
      const slugs = skills.map((s) => s.slug);
      expect(new Set(slugs).size, "duplicate slug").toBe(slugs.length);
      for (const slug of slugs) {
        expect(slug, `invalid opencode slug: ${slug}`).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      }
    });
  });

  describe("when a skill is rendered", () => {
    it("opens with opencode frontmatter carrying name and description", () => {
      for (const skill of skills) {
        const m = renderSkill(skill).match(/^---\n([\s\S]*?)\n---\n/);
        expect(m, `${skill.slug}: no frontmatter block`).not.toBeNull();
        expect(m![1], `${skill.slug}: frontmatter missing name`).toMatch(/^name:\s*\S/m);
        expect(m![1], `${skill.slug}: frontmatter missing description`).toMatch(/^description:\s*\S/m);
      }
    });

    it("inlines shared partials — no leftover MDX import or unrendered component", () => {
      for (const skill of skills) {
        const noCode = renderSkill(skill).replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
        expect(noCode, `${skill.slug}: leftover import`).not.toMatch(/^import\s+\w+\s+from\s+['"][^'"]+\.mdx?['"]/m);
        expect(noCode, `${skill.slug}: unrendered component`).not.toMatch(/^<[A-Z]\w*\s*\/>\s*$/m);
        expect(noCode, `${skill.slug}: leftover _shared ref`).not.toContain("_shared/");
      }
    });

    it("preserves the published skill content verbatim — not a stripped rewrite", () => {
      const tracing = renderSkill(skills.find((s) => s.slug === "tracing")!);
      expect(tracing).toContain("Add LangWatch Tracing to Your Code");
      expect(tracing).toContain("langwatch trace search");
    });
  });
});
