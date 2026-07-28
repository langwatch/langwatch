import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  listNativeSkills,
  listPublishedSkills,
  renderSkill,
} from "../_compiler/native.js";
import {
  FEATURE_SKILLS,
  NATIVE_ONLY_SKILLS,
} from "../_lib/feature-skills.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const skills = listNativeSkills(skillsRoot);
const publishedSkills = listPublishedSkills(skillsRoot);

// Backs specs/langy/langy-native-skills.feature. Langy loads every published
// skill plus explicitly native-only skills, all from canonical root sources.

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

    it("includes native-only skills without adding them to the public set", () => {
      const nativeSlugs = skills.map((skill) => skill.slug);
      const publishedSlugs = publishedSkills.map((skill) => skill.slug);
      for (const slug of NATIVE_ONLY_SKILLS) {
        expect(nativeSlugs).toContain(slug);
        expect(publishedSlugs).not.toContain(slug);
      }
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

    it("carries exactly the native skill set — no extras, none missing", () => {
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

    it("keeps the Go embed copy of github synchronized with its root source", () => {
      const embedded = fs.readFileSync(
        path.resolve(
          skillsRoot,
          "..",
          "services/langyagent/internal/assets/skills/github/SKILL.md",
        ),
        "utf8",
      );
      expect(embedded).toBe(
        fs.readFileSync(path.join(nativeDir, "github/SKILL.md"), "utf8"),
      );
    });
  });

  // AGENTS.md tells Langy which skill to invoke per user intent. A row naming
  // a skill that isn't in the shipped image teaches the model to hallucinate.
  // The image's skill set is the root-compiled native set Docker overlays into
  // the Go embed directory.
  describe("given Langy's AGENTS.md routing table", () => {
    const readAgentsMd = () =>
      fs.readFileSync(
        path.resolve(skillsRoot, "..", "services", "langyagent", "internal", "assets", "AGENTS.md"),
        "utf8",
      );

    /** | user intent | `skill` | primary commands | — rows that name a skill. */
    const routingRows = (): { skill: string; commands: string }[] =>
      readAgentsMd()
        .split("\n")
        .filter((row) => row.startsWith("|"))
        .map((row) => row.split("|").map((cell) => cell.trim()))
        .flatMap((cells) => {
          const skill = cells[2]?.match(/^`([a-z0-9-]+)`$/)?.[1];
          return skill ? [{ skill, commands: cells[3] ?? "" }] : [];
        });

    it("routes only to skills that exist in the shipped image", () => {
      const routed = new Set(routingRows().map((row) => row.skill));
      expect(routed.size, "no skill rows found — did the routing table move?").toBeGreaterThan(0);

      const shipped = new Set(skills.map((s) => s.slug));
      for (const name of routed) {
        expect(shipped.has(name), `AGENTS.md routes to a skill that does not ship: ${name}`).toBe(true);
      }
    });

    // The commands a row names are the ones the model reaches for. For an
    // evaluation request the type it picks must come from the CATALOG — the
    // accepted set — and never from `evaluator list`, which answers what this
    // project already saved: on a project with none that draws an empty card
    // mid-flow, reading as the create having failed before it was attempted.
    describe("when the row answers an evaluation request", () => {
      const EVALUATION_SKILLS = ["experiments", "online-evaluations"];
      const evaluationRows = () =>
        routingRows().filter((row) => EVALUATION_SKILLS.includes(row.skill));

      /** @scenario The assistant is pointed at the catalog rather than the project's evaluators */
      it("points choosing a type at the type catalog", () => {
        const rows = evaluationRows();
        expect(
          rows.map((row) => row.skill).sort(),
          "the evaluation routing rows moved — this check is scanning nothing",
        ).toEqual([...EVALUATION_SKILLS].sort());

        for (const row of rows) {
          expect(
            row.commands,
            `${row.skill} does not name the evaluator type catalog`,
          ).toContain("langwatch evaluator types");
        }
      });

      it("never names listing the project's saved evaluators as a step", () => {
        for (const row of evaluationRows()) {
          expect(
            row.commands,
            `${row.skill} sends the model to the evaluator library`,
          ).not.toContain("langwatch evaluator list");
        }
      });
    });
  });
});
