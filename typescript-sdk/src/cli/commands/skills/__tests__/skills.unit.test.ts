/**
 * `langwatch skills …` — the embedded bundle's integrity (all published
 * skills, partials fully inlined, version in lock-step with skills/) and the
 * install/uninstall/update filesystem semantics (round-trips against a temp
 * install root, dry-run, --force and managed-file safety, non-TTY refusal).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyUninstall,
  findSkill,
  installSkill,
  MANAGED_MARKER,
  planUninstall,
  renderSkillFile,
  resolveSkillsRoot,
  skillFilePath,
  updateSkill,
  SKILLS_BUNDLE,
  SKILLS_BUNDLE_VERSION,
  type BundledSkill,
} from "../installer";
import { skillsListCommand } from "../list";
import { skillsGetCommand } from "../get";
import { skillsInstallCommand } from "../install";
import { skillsUninstallCommand } from "../uninstall";
import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

const REPO_ROOT = path.join(__dirname, "../../../../../../");
const SKILLS_ROOT = path.join(REPO_ROOT, "skills");

/** The published set, read from the same sources the codegen reads. */
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
  return [...featureSkills, ...recipes];
};

const skill = (slug: string): BundledSkill => {
  const found = findSkill(slug);
  if (!found) throw new Error(`test setup: no bundled skill ${slug}`);
  return found;
};

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

describe("the skills installer, given a temp install root", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lw-skills-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("resolves the default root to ~/.agents", () => {
    expect(resolveSkillsRoot()).toBe(path.join(os.homedir(), ".agents"));
    expect(resolveSkillsRoot("./.agents")).toBe(path.resolve("./.agents"));
  });

  it("installs a feature skill to skills/<slug> and a recipe to skills/recipes/<slug>", () => {
    const tracing = installSkill(skill("tracing"), root, {});
    expect(tracing.action).toBe("created");
    expect(tracing.path).toBe(
      path.join(root, "skills", "tracing", "SKILL.md"),
    );
    expect(fs.readFileSync(tracing.path, "utf8")).toBe(
      renderSkillFile(skill("tracing")),
    );

    const recipe = installSkill(skill("debug-instrumentation"), root, {});
    expect(recipe.path).toBe(
      path.join(root, "skills", "recipes", "debug-instrumentation", "SKILL.md"),
    );
  });

  it("marks installed files as managed", () => {
    const result = installSkill(skill("tracing"), root, {});
    expect(fs.readFileSync(result.path, "utf8")).toContain(MANAGED_MARKER);
  });

  it("writes nothing in dry-run mode but reports the would-be action", () => {
    const result = installSkill(skill("tracing"), root, { dryRun: true });
    expect(result.action).toBe("created");
    expect(fs.existsSync(result.path)).toBe(false);
  });

  it("reports an identical reinstall as unchanged", () => {
    installSkill(skill("tracing"), root, {});
    expect(installSkill(skill("tracing"), root, {}).action).toBe("unchanged");
  });

  it("refuses to overwrite a differing file without --force, overwrites with it", () => {
    const target = skillFilePath(root, skill("tracing"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "# the user's own file\n", "utf8");

    const skipped = installSkill(skill("tracing"), root, {});
    expect(skipped.action).toBe("skipped");
    expect(skipped.reason).toContain("--force");
    expect(fs.readFileSync(target, "utf8")).toBe("# the user's own file\n");

    const forced = installSkill(skill("tracing"), root, { force: true });
    expect(forced.action).toBe("updated");
    expect(fs.readFileSync(target, "utf8")).toContain(MANAGED_MARKER);
  });

  it("points a managed older-version install at `skills update` when skipping", () => {
    const target = skillFilePath(root, skill("tracing"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `# old tracing skill\n\n<!-- managed-by: langwatch-skills v0.0.1 -->\n`,
      "utf8",
    );

    const skipped = installSkill(skill("tracing"), root, {});
    expect(skipped.action).toBe("skipped");
    expect(skipped.reason).toContain("langwatch skills update");
    expect(skipped.reason).toContain("v0.0.1");
  });

  it("uninstalls only managed files, in dry-run and for real", () => {
    const { path: managed } = installSkill(skill("tracing"), root, {});
    const foreign = skillFilePath(root, skill("prompts"));
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, "# not ours\n", "utf8");

    const plan = [
      planUninstall(skill("tracing"), root),
      planUninstall(skill("prompts"), root),
      planUninstall(skill("scenarios"), root), // never installed
    ];
    expect(plan.map((p) => p.action)).toEqual(["removed", "skipped", "skipped"]);
    expect(plan[2]!.reason).toBe("not installed");

    applyUninstall(plan, { dryRun: true });
    expect(fs.existsSync(managed)).toBe(true);

    applyUninstall(plan);
    expect(fs.existsSync(managed)).toBe(false);
    expect(fs.readFileSync(foreign, "utf8")).toBe("# not ours\n");
  });

  it("keeps a locally modified managed file unless -y is given", () => {
    const { path: managed } = installSkill(skill("tracing"), root, {});
    fs.appendFileSync(managed, "\nuser notes\n", "utf8");

    expect(planUninstall(skill("tracing"), root).action).toBe("skipped");
    expect(planUninstall(skill("tracing"), root, { yes: true }).action).toBe("removed");
  });

  it("updates only managed files whose content drifted from the bundle", () => {
    const { path: managed } = installSkill(skill("tracing"), root, {});
    expect(updateSkill(skill("tracing"), root, {}).action).toBe("unchanged");

    // Simulate an older bundle install: managed marker, stale content.
    fs.writeFileSync(
      managed,
      `# old tracing skill\n\n<!-- managed-by: langwatch-skills v0.0.1 -->\n`,
      "utf8",
    );
    const dry = updateSkill(skill("tracing"), root, { dryRun: true });
    expect(dry.action).toBe("updated");
    expect(fs.readFileSync(managed, "utf8")).toContain("old tracing skill");

    const applied = updateSkill(skill("tracing"), root, {});
    expect(applied.action).toBe("updated");
    expect(fs.readFileSync(managed, "utf8")).toBe(
      renderSkillFile(skill("tracing")),
    );

    // A file without the marker is never overwritten by update.
    const foreign = skillFilePath(root, skill("prompts"));
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, "# not ours\n", "utf8");
    expect(updateSkill(skill("prompts"), root, {}).action).toBe("skipped");
    expect(fs.readFileSync(foreign, "utf8")).toBe("# not ours\n");
  });

  it("update skips a locally modified managed file without --force, overwrites with it", () => {
    // Current-version marker but edited content = the user's own changes.
    const { path: managed } = installSkill(skill("tracing"), root, {});
    fs.appendFileSync(managed, "\nuser notes\n", "utf8");

    const skipped = updateSkill(skill("tracing"), root, {});
    expect(skipped.action).toBe("skipped");
    expect(skipped.reason).toBe("locally modified; pass --force");
    expect(fs.readFileSync(managed, "utf8")).toContain("user notes");

    const forced = updateSkill(skill("tracing"), root, { force: true });
    expect(forced.action).toBe("updated");
    expect(fs.readFileSync(managed, "utf8")).toBe(
      renderSkillFile(skill("tracing")),
    );
  });

  it("update refreshes a stale-version managed install without --force", () => {
    // Older-version marker = clean install from a previous bundle, not edits.
    const target = skillFilePath(root, skill("tracing"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `# old tracing skill\n\n<!-- managed-by: langwatch-skills v0.0.1 -->\n`,
      "utf8",
    );

    const result = updateSkill(skill("tracing"), root, {});
    expect(result.action).toBe("updated");
    expect(fs.readFileSync(target, "utf8")).toBe(
      renderSkillFile(skill("tracing")),
    );
  });
});

describe("the skills commands", () => {
  let root: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lw-skills-cmd-"));
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const name of AGENT_MODE_ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    for (const name of AGENT_MODE_ENV_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  const logged = (): string => consoleLogSpy.mock.calls.flat().join("\n");

  it("list reports the installed state at the target root", async () => {
    installSkill(skill("tracing"), root, {});
    await skillsListCommand({ dir: root, output: "json" });
    const parsed = JSON.parse(logged()) as {
      skills: { slug: string; installed: boolean }[];
    };
    const tracing = parsed.skills.find((row) => row.slug === "tracing")!;
    const prompts = parsed.skills.find((row) => row.slug === "prompts")!;
    expect(tracing.installed).toBe(true);
    expect(prompts.installed).toBe(false);
  });

  it("get prints the raw skill body, and structured data with -o json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await skillsGetCommand("tracing", {});
    const raw = stdoutSpy.mock.calls.flat().join("");
    expect(raw).toBe(skill("tracing").body);
    expect(raw.startsWith("---\nname: tracing")).toBe(true);

    await skillsGetCommand("recipes/setup-lw", { output: "json" });
    const parsed = JSON.parse(logged()) as { slug: string; body: string };
    expect(parsed.slug).toBe("recipes/setup-lw");
    expect(parsed.body).toContain("langwatch login");
  });

  it("get rejects an unknown skill with a validation error", async () => {
    await expect(skillsGetCommand("nope", {})).rejects.toMatchObject({
      code: "validation_error",
    });
  });

  it("install requires names or --all, and rejects unknown names", async () => {
    await expect(skillsInstallCommand([], { dir: root })).rejects.toMatchObject({
      code: "validation_error",
    });
    await expect(
      skillsInstallCommand(["nope"], { dir: root }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  it("install --all --dry-run reports every skill and writes nothing", async () => {
    await skillsInstallCommand([], { dir: root, all: true, dryRun: true, output: "json" });
    const parsed = JSON.parse(logged()) as {
      dryRun: boolean;
      results: { action: string }[];
    };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.results).toHaveLength(SKILLS_BUNDLE.length);
    expect(parsed.results.every((r) => r.action === "created")).toBe(true);
    expect(fs.existsSync(path.join(root, "skills"))).toBe(false);
  });

  it("install → update → uninstall round-trips through the commands", async () => {
    await skillsInstallCommand(["tracing"], { dir: root });
    const installed = path.join(root, "skills", "tracing", "SKILL.md");
    expect(fs.existsSync(installed)).toBe(true);

    await skillsUninstallCommand(["tracing"], { dir: root, yes: true });
    expect(fs.existsSync(installed)).toBe(false);
  });

  it("uninstall refuses non-interactively without -y (never prompts an agent)", async () => {
    await skillsInstallCommand(["tracing"], { dir: root });
    // vitest's stdin has no TTY — the command must fail, not block.
    expect(process.stdin.isTTY).toBeFalsy();
    await expect(
      skillsUninstallCommand(["tracing"], { dir: root }),
    ).rejects.toMatchObject({
      code: "validation_error",
      message: expect.stringContaining("-y"),
    });
    expect(
      fs.existsSync(path.join(root, "skills", "tracing", "SKILL.md")),
    ).toBe(true);
  });

  it("uninstall --dry-run needs no confirmation and removes nothing", async () => {
    installSkill(skill("tracing"), root, {});
    await skillsUninstallCommand(["tracing"], { dir: root, dryRun: true, output: "json" });
    const parsed = JSON.parse(logged()) as { results: { action: string }[] };
    expect(parsed.results[0]!.action).toBe("removed");
    expect(
      fs.existsSync(path.join(root, "skills", "tracing", "SKILL.md")),
    ).toBe(true);
  });
});
