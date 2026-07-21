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
  isManagedContent,
  MANAGED_MARKER,
  planForcedClobbers,
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

/**
 * A local edit the way a user actually makes one: change the skill's PROSE,
 * leaving the managed-by footer where the installer put it (last). Appending
 * below the footer is a different case with different semantics — see the
 * "given a marker that is not the file's last line" block.
 */
const editBody = (filePath: string): void => {
  const content = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(
    filePath,
    content.replace(MANAGED_MARKER, `user notes\n\n${MANAGED_MARKER}`),
    "utf8",
  );
};

const writeFile = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
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
    editBody(managed);

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
    editBody(managed);

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

  describe("given a marker that is not the file's last line", () => {
    // The marker proves authorship only where this installer puts it: last.
    // An unanchored match believes any occurrence anywhere, which is how a
    // user's own file gets silently overwritten by `update`.
    const QUOTED_FOOTER = [
      "# our team's own tracing skill",
      "",
      "Installs from the LangWatch bundle end with a footer like:",
      "",
      "```markdown",
      "<!-- managed-by: langwatch-skills v0.0.1 -->",
      "```",
      "",
      "Ours does not, because we wrote it by hand.",
      "",
    ].join("\n");

    it("does not treat a quoted footer earlier in the file as proof of ownership", () => {
      expect(isManagedContent(QUOTED_FOOTER)).toBe(false);
    });

    it("refuses to update a hand-written file that merely quotes an old footer", () => {
      const target = skillFilePath(root, skill("tracing"));
      writeFile(target, QUOTED_FOOTER);

      const result = updateSkill(skill("tracing"), root, {});
      expect(result.action).toBe("skipped");
      expect(result.reason).toContain("not managed by `langwatch skills`");
      expect(fs.readFileSync(target, "utf8")).toBe(QUOTED_FOOTER);
    });

    it("refuses to uninstall a hand-written file that merely quotes an old footer", () => {
      const target = skillFilePath(root, skill("tracing"));
      writeFile(target, QUOTED_FOOTER);

      const plan = planUninstall(skill("tracing"), root, { yes: true });
      expect(plan.action).toBe("skipped");
      expect(plan.reason).toContain("not managed by `langwatch skills`");
    });

    it("reads the version from the trailing marker, not an earlier stale one", () => {
      // Quoted v0.0.1 up top, genuine CURRENT footer at the end: this IS ours,
      // and it carries local edits — so it needs --force, not a silent refresh.
      const target = skillFilePath(root, skill("tracing"));
      writeFile(target, `${QUOTED_FOOTER}\n${MANAGED_MARKER}\n`);

      const result = updateSkill(skill("tracing"), root, {});
      expect(result.action).toBe("skipped");
      expect(result.reason).toBe("locally modified; pass --force");
    });

    it("stops treating a managed file as ours once content is appended below the footer", () => {
      // Deliberately conservative: text after the footer means the last bytes
      // are no longer ours, so the safe answer is to leave the file alone.
      const { path: managed } = installSkill(skill("tracing"), root, {});
      fs.appendFileSync(managed, "\nuser notes\n", "utf8");

      expect(planUninstall(skill("tracing"), root, { yes: true }).action).toBe(
        "skipped",
      );
      expect(updateSkill(skill("tracing"), root, { force: true }).action).toBe(
        "skipped",
      );
      expect(fs.readFileSync(managed, "utf8")).toContain("user notes");
    });

    it("still recognises a managed file with trailing blank lines", () => {
      const { path: managed } = installSkill(skill("tracing"), root, {});
      fs.appendFileSync(managed, "\n\n", "utf8");

      expect(planUninstall(skill("tracing"), root, { yes: true }).action).toBe(
        "removed",
      );
    });
  });

  describe("when a skill path is a symbolic link", () => {
    it("refuses to write through it, leaving the link's target untouched", () => {
      const outside = path.join(root, "outside.md");
      fs.writeFileSync(outside, "# somebody else's file\n", "utf8");

      const target = skillFilePath(root, skill("tracing"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(outside, target);

      const result = installSkill(skill("tracing"), root, { force: true });
      expect(result.action).toBe("skipped");
      expect(result.failed).toBe(true);
      expect(result.reason).toContain("symbolic link");
      expect(fs.readFileSync(outside, "utf8")).toBe("# somebody else's file\n");
      expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    });

    it("refuses a dangling link too, rather than creating the file it points at", () => {
      const outside = path.join(root, "not-there-yet.md");
      const target = skillFilePath(root, skill("tracing"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(outside, target);

      const result = installSkill(skill("tracing"), root, {});
      expect(result.action).toBe("skipped");
      expect(result.failed).toBe(true);
      expect(fs.existsSync(outside)).toBe(false);
    });
  });

  describe("when a write cannot complete", () => {
    // Root ignores directory permissions, so the write would succeed and the
    // assertions below would be meaningless rather than wrong.
    const asNonRoot = it.skipIf(process.getuid?.() === 0);

    asNonRoot("leaves the existing file whole, and no temp file behind", () => {
      const { path: managed } = installSkill(skill("tracing"), root, {});
      const stale = `# stale\n\n<!-- managed-by: langwatch-skills v0.0.1 -->\n`;
      writeFile(managed, stale);

      // A read-only directory: the temp write fails, exactly where a crash or
      // a full disk would leave a plain writeFileSync half-done.
      const dir = path.dirname(managed);
      fs.chmodSync(dir, 0o555);
      let result;
      try {
        result = updateSkill(skill("tracing"), root, {});
      } finally {
        fs.chmodSync(dir, 0o755);
      }

      expect(result.action).toBe("skipped");
      expect(result.failed).toBe(true);
      expect(result.reason).toMatch(/EACCES|EPERM|EROFS/);

      // The file still holds COMPLETE, marker-carrying content — never the
      // truncated remains that would make the CLI disown its own file.
      const after = fs.readFileSync(managed, "utf8");
      expect(after).toBe(stale);
      expect(isManagedContent(after)).toBe(true);
      expect(fs.readdirSync(dir)).toEqual(["SKILL.md"]);
    });

    it("leaves no temp files behind on a successful write", () => {
      const { path: managed } = installSkill(skill("tracing"), root, {});
      expect(fs.readdirSync(path.dirname(managed))).toEqual(["SKILL.md"]);

      updateSkill(skill("tracing"), root, { force: true });
      expect(fs.readdirSync(path.dirname(managed))).toEqual(["SKILL.md"]);
    });
  });

  describe("when the filesystem refuses one file in a batch", () => {
    it("reports the errno as a skip and still processes the rest", () => {
      // A directory where the SKILL.md should be: readFileSync raises EISDIR.
      const blocked = skillFilePath(root, skill("tracing"));
      fs.mkdirSync(blocked, { recursive: true });

      const results = [skill("tracing"), skill("prompts")].map((entry) =>
        installSkill(entry, root, {}),
      );

      expect(results[0]!.action).toBe("skipped");
      expect(results[0]!.failed).toBe(true);
      expect(results[0]!.reason).toContain("EISDIR");
      expect(results[1]!.action).toBe("created");
      expect(fs.existsSync(results[1]!.path)).toBe(true);
    });

    it("reports a failed removal instead of aborting the uninstall loop", () => {
      const first = installSkill(skill("tracing"), root, {});
      const second = installSkill(skill("prompts"), root, {});
      const plan = [
        planUninstall(skill("tracing"), root),
        planUninstall(skill("prompts"), root),
      ];
      expect(plan.map((p) => p.action)).toEqual(["removed", "removed"]);

      // The path turns into a non-empty directory between plan and apply, so
      // the unlink raises for real (EISDIR) — the race a long-running install
      // and an impatient user genuinely produce.
      fs.rmSync(first.path);
      fs.mkdirSync(first.path);
      fs.writeFileSync(path.join(first.path, "keep.md"), "x", "utf8");

      const applied = applyUninstall(plan);

      expect(applied[0]!.action).toBe("skipped");
      expect(applied[0]!.failed).toBe(true);
      expect(applied[0]!.reason).toMatch(/EISDIR|ERR_FS_EISDIR/);
      expect(fs.existsSync(first.path)).toBe(true);

      // The rest of the batch still ran.
      expect(applied[1]!.action).toBe("removed");
      expect(fs.existsSync(second.path)).toBe(false);
    });
  });

  describe("when planning what --force would clobber", () => {
    it("lists only files carrying content the installer did not write", () => {
      const foreign = skillFilePath(root, skill("tracing"));
      writeFile(foreign, "# the team's own tracing skill\n");

      const { path: managed } = installSkill(skill("prompts"), root, {});
      editBody(managed); // ours, locally edited — still ours
      installSkill(skill("scenarios"), root, {}); // ours, byte-identical
      // skill("evaluations") is not installed at all

      const clobbers = planForcedClobbers(
        [skill("tracing"), skill("prompts"), skill("scenarios")],
        root,
      );
      expect(clobbers.map((c) => c.path)).toEqual([foreign]);
    });
  });

  describe("given a --dir value no shell expanded", () => {
    it("expands a leading ~ against the home directory", () => {
      expect(resolveSkillsRoot("~/.agents")).toBe(
        path.join(os.homedir(), ".agents"),
      );
      expect(resolveSkillsRoot("~")).toBe(os.homedir());
      expect(resolveSkillsRoot("  ~/.agents  ")).toBe(
        path.join(os.homedir(), ".agents"),
      );
    });

    it("never creates a directory literally named ~", () => {
      expect(resolveSkillsRoot("~/.agents")).not.toContain(`${path.sep}~`);
    });

    it("rejects an empty or whitespace --dir rather than using the cwd", () => {
      expect(() => resolveSkillsRoot("")).toThrow(/--dir needs a path/);
      expect(() => resolveSkillsRoot("   ")).toThrow(/--dir needs a path/);
    });

    it("leaves a ~ that is not a leading path segment alone", () => {
      expect(resolveSkillsRoot("./tmp/~backup")).toBe(
        path.resolve("./tmp/~backup"),
      );
    });
  });

  describe("given a slug that is not a single path segment", () => {
    it("refuses to build a path that could escape the install root", () => {
      const traversal: BundledSkill = {
        ...skill("tracing"),
        slug: "../../../etc/evil",
      };
      expect(() => skillFilePath(root, traversal)).toThrow(/single path segment/);

      const nested: BundledSkill = { ...skill("tracing"), slug: "a/b" };
      expect(() => skillFilePath(root, nested)).toThrow(/single path segment/);
    });
  });
});
