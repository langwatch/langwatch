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

  // skills/_compiled/native/ is COMMITTED (Dockerfile.langyagent copies it into
  // the manager's go:embed dir at image build), so an edited SKILL.mdx whose
  // author forgot to regenerate ships STALE instructions to Langy. This block
  // turns that silent drift into a red test.
  describe("given the committed _compiled/native output", () => {
    const nativeDir = path.join(skillsRoot, "_compiled", "native");

    it("carries exactly the published skill set — no extras, none missing", () => {
      const committed = fs
        .readdirSync(nativeDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      expect(committed).toEqual(skills.map((s) => s.slug).sort());
    });

    it("matches the sources — regenerate with `bash skills/_compiled/generate.sh`", () => {
      for (const skill of skills) {
        const committed = fs.readFileSync(path.join(nativeDir, skill.slug, "SKILL.md"), "utf8");
        expect(committed, `${skill.slug}: committed native output is stale`).toBe(renderSkill(skill));
      }
    });

    it("never contains the Langy-internal github skill — that one lives in the Go embed dir only", () => {
      // services/langyagent/internal/assets/skills/github/ is provisioning-
      // coupled (GH_TOKEN, bot identity) and must never reach this tree, from
      // which skills are published externally.
      expect(fs.existsSync(path.join(nativeDir, "github"))).toBe(false);
    });
  });

  // AGENTS.md tells Langy which skill to invoke per user intent. A row naming
  // a skill that isn't in the shipped image teaches the model to hallucinate.
  // The image's skill set = this workspace's published set (Docker overlay of
  // _compiled/native) + the Langy-internal skills checked into the Go embed dir.
  describe("given Langy's AGENTS.md routing table", () => {
    it("routes only to skills that exist in the shipped image", () => {
      const langyAssets = path.resolve(skillsRoot, "..", "services", "langyagent", "internal", "assets");
      const agentsMd = fs.readFileSync(path.join(langyAssets, "AGENTS.md"), "utf8");

      const routed = new Set<string>();
      for (const row of agentsMd.split("\n")) {
        if (!row.startsWith("|")) continue;
        // | user intent | `skill` | commands | — skill is the second cell.
        const cell = row.split("|").map((c) => c.trim())[2];
        const m = cell?.match(/^`([a-z0-9-]+)`$/);
        if (m) routed.add(m[1]!);
      }
      expect(routed.size, "no skill rows found — did the routing table move?").toBeGreaterThan(0);

      const embedded = fs
        .readdirSync(path.join(langyAssets, "skills"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      const shipped = new Set([...skills.map((s) => s.slug), ...embedded]);
      for (const name of routed) {
        expect(shipped.has(name), `AGENTS.md routes to a skill that does not ship: ${name}`).toBe(true);
      }
    });
  });
});
