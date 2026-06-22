import { describe, expect, it } from "vitest";
import { discoverSkills, renderSkill } from "../_compiler/native.js";

// Backs specs/assistant/langy-native-skills.feature. The native generator is
// the single source the Langy in-product assistant loads its skills from, so
// these guard (a) every canonical skill is discovered, (b) output is a valid
// opencode SKILL.md, and (c) the in-product wording — no "ask for a key", no
// "install the CLI" — which is what makes the canonical skills safe to reuse
// inside the product.

const all = discoverSkills();
const rendered = all.map((s) => ({ slug: s.slug, text: renderSkill(s) }));

// Canonical wording that is correct for an external coding agent but wrong
// in-product, where credentials and the CLI are already provisioned.
const EXTERNAL_SETUP_LEAKS = [
  /ask the user for it/i,
  /mint (?:a key|one)/i,
  /app\.langwatch\.ai\/authorize/i,
  /npm install -g langwatch/i,
  /langwatch login/i,
];

describe("native skill generation", () => {
  describe("given the canonical skill directory", () => {
    it("discovers the top-level skills and the recipes", () => {
      const slugs = all.map((s) => s.slug);
      // Top-level skills behind the public directory page.
      for (const skill of ["tracing", "evaluations", "scenarios", "prompts", "analytics", "datasets", "level-up"]) {
        expect(slugs, `missing top-level skill: ${skill}`).toContain(skill);
      }
      // Recipes are skills too — they must come along, not be dropped.
      expect(slugs).toContain("debug-instrumentation");
      expect(slugs).toContain("test-compliance");
    });

    it("derives a unique opencode-valid name slug for every skill", () => {
      const slugs = all.map((s) => s.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) {
        // opencode name contract: 1-64 chars, lowercase alphanumeric + hyphens.
        expect(slug, `invalid skill slug: ${slug}`).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      }
    });
  });

  describe("when a canonical skill is rendered", () => {
    it("opens with opencode frontmatter carrying name and description", () => {
      for (const { slug, text } of rendered) {
        const m = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
        expect(m, `${slug}: output is not a valid SKILL.md frontmatter block`).not.toBeNull();
        expect(m![1]!.trim()).toBe(slug);
        // description is emitted as a JSON/YAML double-quoted scalar.
        expect(m![2]!.trim(), `${slug}: description not safely quoted`).toMatch(/^".*"$/);
      }
    });

    it("leaves no unrendered MDX import or partial marker in the body", () => {
      for (const { slug, text } of rendered) {
        const noCode = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
        expect(noCode, `${slug}: leftover ESM import`).not.toMatch(/^import\s+\w+\s+from\s+['"][^'"]+\.mdx?['"]/m);
        expect(noCode, `${slug}: unrendered <Component />`).not.toMatch(/^<[A-Z]\w*\s*\/>\s*$/m);
        expect(noCode, `${slug}: leftover _shared reference`).not.toContain("_shared/");
      }
    });
  });

  describe("when rendered for the in-product worker", () => {
    it("never instructs the user to obtain a key or install tooling it already has", () => {
      const offenders: string[] = [];
      for (const { slug, text } of rendered) {
        for (const leak of EXTERNAL_SETUP_LEAKS) {
          if (leak.test(text)) offenders.push(`${slug}: matched ${leak}`);
        }
      }
      expect(offenders, `external-setup wording leaked into in-product skills:\n  ${offenders.join("\n  ")}`).toEqual([]);
    });

    it("states that authentication is already handled where the canonical key partial was inlined", () => {
      // Every skill that imported <ProjectsAndApiKeys/> must now carry the
      // in-product variant instead. analytics is one such skill.
      const analytics = rendered.find((r) => r.slug === "analytics")!;
      expect(analytics.text).toMatch(/already authenticated to the\s+user's current project/);
      expect(analytics.text).toMatch(/Never ask the user for an API key/);
    });
  });
});
