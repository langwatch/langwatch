/**
 * The embedded skills bundle's integrity: all published skills, partials
 * fully inlined, version in lock-step with skills/, and byte-identical to the
 * committed native renders the publisher and Langy also consume.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findSkill,
  SKILLS_BUNDLE,
  SKILLS_BUNDLE_VERSION,
  type BundledSkill,
} from "../installer";

const REPO_ROOT = path.join(__dirname, "../../../../../../../");
const SKILLS_ROOT = path.join(REPO_ROOT, "skills");

/**
 * Whether a skill's opening YAML frontmatter declares a `feature-flag:` key.
 * Scoped to the frontmatter block ONLY: matching anywhere in the file would let
 * a `feature-flag:` line inside a fenced body example wrongly exclude a
 * publishable skill from the bundle.
 */
const frontmatterIsFlagGated = (source: string): boolean => {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
  return /^feature-flag:\s*\S+/m.test(frontmatter);
};

/** A skill's own SKILL.mdx frontmatter says whether it's gated by a feature flag. */
const isFlagGated = (src: string): boolean =>
  frontmatterIsFlagGated(fs.readFileSync(src, "utf8"));

/**
 * The published set, read from the same sources the codegen reads. Skills
 * gated by a `feature-flag:` frontmatter key are excluded, mirroring
 * generate-skills-bundle.mjs — the CLI bundle ships inside the binary with
 * no per-caller flag to resolve, so a gated skill isn't in it yet.
 */
const expectedPublishedSlugs = (): { slug: string; isRecipe: boolean }[] => {
  const featureSkillsSrc = fs.readFileSync(
    path.join(SKILLS_ROOT, "_lib/feature-skills.ts"),
    "utf8",
  );
  const match = /export const FEATURE_SKILLS = \[([\s\S]*?)\] as const;/.exec(
    featureSkillsSrc,
  );
  const featureSkills = [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
    (m) => ({ slug: m[1]!, isRecipe: false }),
  );
  const recipes = fs
    .readdirSync(path.join(SKILLS_ROOT, "recipes"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      fs.existsSync(path.join(SKILLS_ROOT, "recipes", entry.name, "SKILL.mdx")),
    )
    .map((entry) => ({ slug: entry.name, isRecipe: true }));
  return [
    ...featureSkills.filter(
      ({ slug }) => !isFlagGated(path.join(SKILLS_ROOT, slug, "SKILL.mdx")),
    ),
    ...recipes.filter(
      ({ slug }) =>
        !isFlagGated(path.join(SKILLS_ROOT, "recipes", slug, "SKILL.mdx")),
    ),
  ];
};

const skill = (slug: string): BundledSkill => {
  const found = findSkill(slug);
  if (!found) throw new Error(`test setup: no bundled skill ${slug}`);
  return found;
};

describe("frontmatterIsFlagGated", () => {
  describe("given a feature-flag key in the opening frontmatter", () => {
    it("reports the skill as gated", () => {
      const source = ["---", "feature-flag: release_x", "---", "# Body"].join(
        "\n",
      );
      expect(frontmatterIsFlagGated(source)).toBe(true);
    });
  });

  describe("given feature-flag only inside a body example", () => {
    it("does not report the skill as gated", () => {
      const source = [
        "---",
        "name: my-skill",
        "---",
        "# Body",
        "",
        "```yaml",
        "feature-flag: release_x",
        "```",
      ].join("\n");
      expect(frontmatterIsFlagGated(source)).toBe(false);
    });
  });
});

describe("the embedded skills bundle", () => {
  it("matches skills/version.txt", () => {
    const version = fs
      .readFileSync(path.join(SKILLS_ROOT, "version.txt"), "utf8")
      .trim();
    expect(SKILLS_BUNDLE_VERSION).toBe(version);
  });

  it("embeds exactly the published set — curated feature skills plus every recipe", () => {
    const expected = expectedPublishedSlugs();
    const actual = SKILLS_BUNDLE.map((entry) => ({
      slug: entry.slug,
      isRecipe: entry.isRecipe,
    }));
    expect(actual.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual(
      expected.sort((a, b) => a.slug.localeCompare(b.slug)),
    );
  });

  it("matches the committed native renders byte-for-byte (one artifact for CLI, publisher, and Langy)", () => {
    for (const entry of SKILLS_BUNDLE) {
      const nativePath = path.join(
        SKILLS_ROOT,
        "_compiled/native",
        entry.slug,
        "SKILL.md",
      );
      expect(
        fs.existsSync(nativePath),
        `${entry.slug}: missing native render — regenerate with bash skills/_compiled/generate.sh`,
      ).toBe(true);
      expect(entry.body, `${entry.slug}: bundle body != native render`).toBe(
        fs.readFileSync(nativePath, "utf8"),
      );
    }
  });

  it("excludes NATIVE_ONLY skills", () => {
    expect(SKILLS_BUNDLE.some((entry) => entry.slug === "github")).toBe(false);
  });

  it("embeds every body fully inlined: frontmatter intact, no MDX imports or JSX left", () => {
    for (const entry of SKILLS_BUNDLE) {
      expect(entry.body.startsWith("---"), `${entry.slug} frontmatter`).toBe(true);
      expect(/^import .*\.mdx/m.test(entry.body), `${entry.slug} MDX imports`).toBe(false);
      expect(/<[A-Z][A-Za-z]* \/>/.test(entry.body), `${entry.slug} JSX`).toBe(false);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("splices shared partials into the bodies that use them", () => {
    // cli-setup.mdx's docs snippet appears verbatim inside importing skills.
    expect(skill("tracing").body).toContain(
      "langwatch docs integration/python/guide",
    );
    expect(skill("recipes/setup-lw").body).toContain(
      "LANGWATCH_API_KEY",
    );
  });

  it("carries name, description and user-prompt from the frontmatter", () => {
    const tracing = skill("tracing");
    expect(tracing.name).toBe("tracing");
    expect(tracing.userPrompt).toBe("Instrument my code with LangWatch");
    expect(tracing.description).toContain("tracing");
  });
});
