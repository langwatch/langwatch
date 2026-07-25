/**
 * The filesystem core of `langwatch skills …` — where the embedded skill
 * bundle (generated at build time from skills/ at the repo root) meets the
 * install root on disk. The semantics mirror gcx `agent skills`:
 *
 *   <root>/skills/<slug>/SKILL.md            feature skills
 *   <root>/skills/recipes/<slug>/SKILL.md    recipes (nested, as published)
 *
 * with <root> defaulting to ~/.agents — the cross-tool convention
 * `npx skills add` also uses — overridable with --dir for project-level
 * .agents/ installs.
 *
 * Every file this installer writes ends with a managed-by marker comment.
 * That marker is what lets `update`/`uninstall` tell "we manage this file"
 * (safe to overwrite/remove) from "the user put something here" (never
 * touched without --force/-y). The marker is an HTML comment, invisible to
 * the markdown renderers agents read skills through.
 *
 * This module plans and executes; it never prints and never exits — the
 * command wrappers own output (printResult) and exit codes.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SKILLS_BUNDLE,
  SKILLS_BUNDLE_VERSION,
  type BundledSkill,
} from "@/internal/generated/cli/skills.generated";
import { throwValidationError } from "./validation";

export { SKILLS_BUNDLE, SKILLS_BUNDLE_VERSION, type BundledSkill };

/**
 * The install root: --dir when given, else ~/.agents.
 *
 * `--dir` is a path a HUMAN typed or a config file supplied, so it gets the
 * two expansions a shell would otherwise have done and this process cannot
 * assume happened. A quoted `--dir "~/.agents"` — or a value an agent put
 * straight into argv, where no shell ever ran — resolves to `$CWD/~/.agents`
 * and silently creates a directory literally named `~`; an empty `--dir ""`
 * resolves to `$CWD` and scatters skills/ into whatever the caller was
 * standing in. Both are refused or corrected here, not discovered later.
 */
export const resolveSkillsRoot = (dir?: string): string => {
  if (dir === undefined) return path.join(os.homedir(), ".agents");

  const trimmed = dir.trim();
  if (trimmed === "") {
    return throwValidationError(
      "--dir needs a path (an empty value would install into the current directory).",
    );
  }
  const expanded =
    trimmed === "~"
      ? os.homedir()
      : trimmed.startsWith("~/")
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed;
  return path.resolve(expanded);
};

/** The marker every installed file ends with (bundle version included). */
export const MANAGED_MARKER = `<!-- managed-by: langwatch-skills v${SKILLS_BUNDLE_VERSION} -->`;

/**
 * Matches the marker from ANY bundle version, so older installs stay managed —
 * anchored to the END of the file, because that is the only place this
 * installer ever writes it.
 *
 * The anchor is load-bearing, not tidiness. An unanchored match believes any
 * occurrence anywhere: a user who pastes a fenced code block quoting an older
 * install's footer into their own hand-written skill hands `update` a stale
 * version string, and `update` then overwrites their file with no --force and
 * no prompt. The symmetric failure has `install` mislabel a locally edited
 * file as a stale install. One trailing match answers both questions.
 *
 * The accepted cost: a user who APPENDS their own notes below the footer of a
 * file we installed drops it out of managed status. They will see `update` say
 * "not managed by `langwatch skills`; use `install --force`" and `uninstall`
 * say "remove it by hand" — friction, and confusing friction given the file
 * plainly carries our marker. It is not data loss: `planForcedClobbers`
 * classifies such a file as a clobber, so even `--force` prompts or refuses
 * rather than silently eating the appended notes. The trade is deliberate and
 * runs in the safe direction — we would rather decline to touch a file that is
 * ours than touch one that is not. Moving the notes ABOVE the footer, or
 * removing the footer entirely, restores the expected behaviour.
 */
const MANAGED_MARKER_RE = /(?:^|\n)<!-- managed-by: langwatch-skills v(\S+) -->\s*$/;

/**
 * Defence in depth: a slug becomes a path segment, so it must not be able to
 * escape the install root. Runtime traversal is not currently reachable —
 * every slug is exact-matched against the compiled bundle by `findSkill` — but
 * nothing in the type system says so, and `BundledSkill` is a plain interface
 * any future caller can construct. A violated invariant throws; it is a bug in
 * the bundle, not a per-file condition to report.
 */
const assertPathSafeSlug = (slug: string): void => {
  if (slug === "" || slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    throw new Error(
      `Refusing to build a skill path from slug ${JSON.stringify(slug)}: slugs must be a single path segment with no "/" or "..".`,
    );
  }
};

export const skillFilePath = ({
  root,
  skill,
}: {
  root: string;
  skill: BundledSkill;
}): string => {
  assertPathSafeSlug(skill.slug);
  return path.join(
    root,
    "skills",
    ...(skill.isRecipe ? ["recipes", skill.slug] : [skill.slug]),
    "SKILL.md",
  );
};

/** The exact file content `install` writes: skill body + managed-by marker. */
export const renderSkillFile = (skill: BundledSkill): string =>
  `${skill.body.trimEnd()}\n\n${MANAGED_MARKER}\n`;

/** Whether this file's LAST bytes are our marker — i.e. we wrote it. */
export const isManagedContent = (content: string): boolean =>
  MANAGED_MARKER_RE.test(content);

/** The bundle version a managed file was installed from, if the marker says. */
const managedVersion = (content: string): string | undefined =>
  MANAGED_MARKER_RE.exec(content)?.[1];

const readIfExists = (filePath: string): string | undefined =>
  fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined;

/** Accepts a bare slug or the published `recipes/<slug>` spelling. */
export const findSkill = (name: string): BundledSkill | undefined => {
  const normalized = name.replace(/^\/+|\/+$/g, "");
  const recipe = /^recipes\/(.+)$/.exec(normalized);
  if (recipe) {
    return SKILLS_BUNDLE.find(
      (skill) => skill.isRecipe && skill.slug === recipe[1],
    );
  }
  return SKILLS_BUNDLE.find((skill) => skill.slug === normalized);
};

/** Resolve names to bundle skills, collecting the ones that don't exist. */
export const resolveSkills = (
  names: string[],
): { skills: BundledSkill[]; unknown: string[] } => {
  const skills: BundledSkill[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const skill = findSkill(name);
    if (skill) skills.push(skill);
    else unknown.push(name);
  }
  return { skills, unknown };
};

export type SkillFileAction =
  | "created"
  | "updated"
  | "removed"
  | "unchanged"
  | "skipped";

export interface SkillFileResult {
  slug: string;
  path: string;
  action: SkillFileAction;
  reason?: string;
  /**
   * This entry is a FAILURE, not a deliberate skip — the filesystem refused
   * the operation. Commands report every result and then exit non-zero if any
   * carries this, so one EACCES never hides the rest of the batch.
   */
  failed?: true;
}

/** `EACCES: permission denied, open '…'` — the errno, said once. */
const fsErrorReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  if (code === undefined || message.startsWith(code)) return message;
  return `${code}: ${message}`;
};

/**
 * Turn a filesystem refusal into a reported skip.
 *
 * Without this a single EACCES/EPERM/EISDIR anywhere in a batch throws out of
 * the `.map()`, `printResult` is never reached, and the caller is told the
 * command failed but not WHICH files were already written — the worst possible
 * report for a half-applied change.
 */
const asFileResult = (
  skill: BundledSkill,
  filePath: string,
  operation: () => SkillFileResult,
): SkillFileResult => {
  try {
    return operation();
  } catch (error) {
    return {
      slug: skill.slug,
      path: filePath,
      action: "skipped",
      reason: fsErrorReason(error),
      failed: true,
    };
  }
};

/**
 * Write a skill file so that it is either fully there or not there at all,
 * and never through a symlink.
 *
 * Atomicity is not a nicety here: the managed-by marker is the LAST bytes of
 * the file, so any interrupted plain write deterministically produces a file
 * that no longer looks managed — `update` and `uninstall` would both then
 * refuse it as somebody else's, and the tool would have bricked its own file
 * with `--force` as the only way back. Writing a sibling temp file and
 * `rename`-ing it (atomic within a filesystem on POSIX) removes that state.
 *
 * The same rename closes a second hole: `writeFileSync` FOLLOWS symlinks, so
 * on a shared install root (`--dir /tmp/shared`, a CI cache, a container
 * volume) a pre-planted symlink at a skill path would let this truncate a file
 * outside the root entirely. `lstat` sees the link itself, and refuses.
 */
/**
 * Delete temp files THIS process orphaned in `dir` on an earlier run.
 *
 * The write below is crash-safe for the skill file but not for its own temp:
 * a signal or hard kill between `writeFileSync` and `renameSync` skips the
 * catch and strands `.SKILL.md.<pid>-<uuid>.tmp` forever, one per Ctrl-C'd
 * `skills install --all`.
 *
 * The sweep is scoped to this process's OWN pid rather than an age threshold
 * because pid is the only signal here that is exact. An age cutoff has to
 * guess how slow a legitimate write can be, and guessing wrong deletes a
 * concurrent installer's in-flight temp out from under it — a corrupted
 * install to tidy up litter. A recycled pid is the one false positive, and it
 * can only ever hit a temp the recycled owner already abandoned. Temps left by
 * OTHER pids stay: harmless, and not ours to judge.
 */
const sweepOrphanedTemps = (dir: string, fileName: string): void => {
  const prefix = `.${fileName}.${process.pid}-`;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(prefix) && entry.endsWith(".tmp")) {
        fs.rmSync(path.join(dir, entry), { force: true });
      }
    }
  } catch {
    // Best-effort tidying: never fail an install over leftover litter.
  }
};

const writeSkill = (filePath: string, content: string): void => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  sweepOrphanedTemps(dir, path.basename(filePath));

  const link = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (link?.isSymbolicLink()) {
    throw Object.assign(
      new Error(
        `${filePath} is a symbolic link; refusing to write through it (remove the link and re-run).`,
      ),
      { code: "ESYMLINK" },
    );
  }

  const temp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}-${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temp, content, "utf8");
    fs.renameSync(temp, filePath);
  } catch (error) {
    // The cleanup gets its own try/catch so it can never REPLACE the failure
    // being handled: an EACCES on unlink surfacing instead of the ENOSPC that
    // actually stopped the write sends the user to debug the wrong thing.
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Leave the temp behind; the sweep above reclaims it next run.
    }
    throw error;
  }
};

/**
 * Install one skill: create when missing, leave identical files alone, and
 * refuse to overwrite a differing file unless --force was passed (gcx
 * semantics — a differing file may be the user's own edit or another
 * installer's work). A file we manage from an OLDER bundle is pointed at
 * `langwatch skills update`, the intended path for it.
 */
export const installSkill = ({
  skill,
  root,
  dryRun = false,
  force = false,
}: {
  skill: BundledSkill;
  root: string;
  dryRun?: boolean;
  force?: boolean;
}): SkillFileResult => {
  const filePath = skillFilePath({ root, skill });
  return asFileResult(skill, filePath, () => {
    const wanted = renderSkillFile(skill);
    const existing = readIfExists(filePath);

    if (existing === undefined) {
      if (!dryRun) writeSkill(filePath, wanted);
      return { slug: skill.slug, path: filePath, action: "created" };
    }
    if (existing === wanted) {
      return { slug: skill.slug, path: filePath, action: "unchanged" };
    }
    if (!force) {
      const installedVersion = managedVersion(existing);
      const reason =
        installedVersion === undefined
          ? "differs from the bundle; pass --force to overwrite"
          : installedVersion !== SKILLS_BUNDLE_VERSION
            ? `installed from bundle v${installedVersion}; run \`langwatch skills update\` (or pass --force to overwrite)`
            : "locally modified; pass --force to overwrite";
      return { slug: skill.slug, path: filePath, action: "skipped", reason };
    }
    if (!dryRun) writeSkill(filePath, wanted);
    return { slug: skill.slug, path: filePath, action: "updated" };
  });
};

/** A file `--force` would truncate that this installer did not write. */
export interface ForcedClobber {
  slug: string;
  path: string;
}

/**
 * Plan which of these skills' targets `--force` would destroy content in.
 *
 * `--force` is the one flag that reasons about nothing — it skips the marker
 * and version checks entirely and truncates whatever is at the path. That is
 * fine for a file we wrote; it is not fine for the team's hand-written
 * `.agents/skills/tracing/SKILL.md`, which `install --all --force` would
 * silently replace. So the commands gate on THIS list — files with content we
 * do not manage — exactly the way `uninstall` gates on removals, and leave
 * overwriting our own files frictionless.
 *
 * A file we cannot even read counts as a clobber: unreadable is not the same
 * as ours.
 */
export const planForcedClobbers = (
  skills: BundledSkill[],
  root: string,
): ForcedClobber[] => {
  const clobbers: ForcedClobber[] = [];
  for (const skill of skills) {
    const filePath = skillFilePath({ root, skill });
    let existing: string | undefined;
    try {
      existing = readIfExists(filePath);
    } catch {
      clobbers.push({ slug: skill.slug, path: filePath });
      continue;
    }
    if (existing === undefined) continue;
    if (existing === renderSkillFile(skill)) continue;
    if (isManagedContent(existing)) continue;
    clobbers.push({ slug: skill.slug, path: filePath });
  }
  return clobbers;
};

/**
 * Plan an uninstall without touching the disk, so the command can ask for
 * confirmation (or refuse, non-TTY) before anything is removed.
 *
 * A path the filesystem refuses to even READ (EISDIR, EACCES) becomes a failed
 * skip like everywhere else — planning a bundle must not abort halfway on one
 * bad path, leaving the other skills' fate unreported.
 *
 * Only files the bundle manages are ever removed: byte-identical installs,
 * or marker-carrying files — a modified managed file additionally needs -y
 * (it may carry the user's edits). A file with no marker and different
 * content is not ours; it stays.
 */
export const planUninstall = ({
  skill,
  root,
  yes = false,
}: {
  skill: BundledSkill;
  root: string;
  yes?: boolean;
}): SkillFileResult => {
  const filePath = skillFilePath({ root, skill });
  return asFileResult(skill, filePath, () => {
    const existing = readIfExists(filePath);

    if (existing === undefined) {
      return {
        slug: skill.slug,
        path: filePath,
        action: "skipped",
        reason: "not installed",
      };
    }
    if (existing === renderSkillFile(skill)) {
      return { slug: skill.slug, path: filePath, action: "removed" };
    }
    if (isManagedContent(existing)) {
      if (!yes) {
        return {
          slug: skill.slug,
          path: filePath,
          action: "skipped",
          reason: "locally modified; pass -y to remove anyway",
        };
      }
      return { slug: skill.slug, path: filePath, action: "removed" };
    }
    return {
      slug: skill.slug,
      path: filePath,
      action: "skipped",
      reason: "not managed by `langwatch skills`; remove it by hand",
    };
  });
};

/**
 * Execute a confirmed uninstall plan, returning the plan as it actually
 * turned out: a removal the filesystem refused comes back as a failed skip
 * rather than throwing out of the loop and stranding the caller with no
 * record of which files were already gone.
 */
export const applyUninstall = ({
  results,
  dryRun = false,
}: {
  results: SkillFileResult[];
  dryRun?: boolean;
}): SkillFileResult[] => {
  if (dryRun) return results;
  return results.map((result) => {
    if (result.action !== "removed") return result;
    try {
      fs.rmSync(result.path, { force: true });
      return result;
    } catch (error) {
      return {
        slug: result.slug,
        path: result.path,
        action: "skipped",
        reason: fsErrorReason(error),
        failed: true,
      };
    }
  });
};

/**
 * Refresh one installed skill to the bundle's content. Only files we manage
 * (marker present) are overwritten — anything else is the user's to sort out,
 * with `install --force` as the explicit escape hatch.
 *
 * The marker's version is what separates a stale install from a user edit: a
 * file managed by an OLDER bundle differs because the bundle advanced, so
 * updating it is the whole point of this command; a file managed by the
 * CURRENT bundle that still differs carries local edits, and — mirroring
 * uninstall's -y — those are only overwritten with --force.
 */
export const updateSkill = ({
  skill,
  root,
  dryRun = false,
  force = false,
}: {
  skill: BundledSkill;
  root: string;
  dryRun?: boolean;
  force?: boolean;
}): SkillFileResult => {
  const filePath = skillFilePath({ root, skill });
  return asFileResult(skill, filePath, () => {
    const wanted = renderSkillFile(skill);
    const existing = readIfExists(filePath);

    if (existing === undefined) {
      return {
        slug: skill.slug,
        path: filePath,
        action: "skipped",
        reason: "not installed; use `langwatch skills install`",
      };
    }
    if (existing === wanted) {
      return { slug: skill.slug, path: filePath, action: "unchanged" };
    }
    const installedVersion = managedVersion(existing);
    if (installedVersion === undefined) {
      return {
        slug: skill.slug,
        path: filePath,
        action: "skipped",
        reason: "not managed by `langwatch skills`; use `install --force`",
      };
    }
    if (installedVersion === SKILLS_BUNDLE_VERSION && !force) {
      return {
        slug: skill.slug,
        path: filePath,
        action: "skipped",
        reason: "locally modified; pass --force",
      };
    }
    if (!dryRun) writeSkill(filePath, wanted);
    return { slug: skill.slug, path: filePath, action: "updated" };
  });
};
