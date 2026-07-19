/**
 * The skills installer's filesystem semantics, round-tripped against a temp
 * install root: dry-run, --force and managed-file safety for
 * install/uninstall/update.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  type BundledSkill,
} from "../installer";

const skill = (slug: string): BundledSkill => {
  const found = findSkill(slug);
  if (!found) throw new Error(`test setup: no bundled skill ${slug}`);
  return found;
};

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
