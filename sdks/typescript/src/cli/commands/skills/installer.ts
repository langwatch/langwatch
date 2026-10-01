// Manage skill files on disk with markers to distinguish managed from
// user content; separates planning/execution from output/exit codes.
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

// Resolve install root path; expands ~ and rejects empty or problematic paths.
export const resolveSkillsRoot = (dir?: string): string => {
  if (dir === undefined) return path.join(os.homedir(), ".agents");

  const trimmed = dir.trim();
  if (trimmed === "") {
    return throwValidationError(
      "--dir needs a path (an empty value would install into the current directory).",
    );
  }
  let expanded = trimmed;
  if (trimmed === "~") expanded = os.homedir();
  else if (trimmed.startsWith("~/")) expanded = path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(expanded);
};

/** The marker every installed file ends with (bundle version included). */
export const MANAGED_MARKER = `<!-- managed-by: langwatch-skills v${SKILLS_BUNDLE_VERSION} -->`;

// Detect managed files by marker at end; end-anchoring prevents false positives
// from markers quoted in user content.
const MANAGED_MARKER_RE = /(?:^|\n)<!-- managed-by: langwatch-skills v(\S+) -->\s*$/;

/**
 * Defence in depth: a slug becomes a path segment and must not escape the
 * install root. Not currently reachable, but `BundledSkill` is a plain
 * interface a future caller could construct wrong. A violation throws.
 */
const assertPathSafeSlug = (slug: string): void => {
  if (slug === "") {
    throw new Error(
      `Refusing to build a skill path from slug ${JSON.stringify(slug)}: slugs must be a single path segment with no "/" or "..".`,
    );
  }
  if (slug.includes("/")) {
    throw new Error(
      `Refusing to build a skill path from slug ${JSON.stringify(slug)}: slugs must be a single path segment with no "/" or "..".`,
    );
  }
  if (slug.includes("\\")) {
    throw new Error(
      `Refusing to build a skill path from slug ${JSON.stringify(slug)}: slugs must be a single path segment with no "/" or "..".`,
    );
  }
  if (slug.includes("..")) {
    throw new Error(
      `Refusing to build a skill path from slug ${JSON.stringify(slug)}: slugs must be a single path segment with no "/" or "..".`,
    );
  }
};

export const skillFilePath = ({ root, skill }: { root: string; skill: BundledSkill }): string => {
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
export const isManagedContent = (content: string): boolean => MANAGED_MARKER_RE.test(content);

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
    return SKILLS_BUNDLE.find((skill) => skill.isRecipe && skill.slug === recipe[1]);
  }
  return SKILLS_BUNDLE.find((skill) => skill.slug === normalized);
};

/** Resolve names to bundle skills, collecting the ones that don't exist. */
export const resolveSkills = (names: string[]): { skills: BundledSkill[]; unknown: string[] } => {
  const skills: BundledSkill[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const skill = findSkill(name);
    if (skill) skills.push(skill);
    else unknown.push(name);
  }
  return { skills, unknown };
};

export type SkillFileAction = "created" | "updated" | "removed" | "unchanged" | "skipped";

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
 * Turns a filesystem refusal into a reported skip. Without this, a single
 * EACCES/EPERM/EISDIR anywhere throws out of the `.map()`, and the caller is
 * told the command failed but not WHICH files were already written.
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

// Write atomically via rename; refuse symlinks to block escape attacks.
// Clean up orphaned temps scoped to this process's pid to avoid concurrent conflicts.
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
    void 0;
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
      void 0;
    }
    throw error;
  }
};

/**
 * Installs one skill: creates when missing, leaves identical files alone,
 * refuses to overwrite a differing file unless --force. A file from an
 * OLDER bundle is pointed at `langwatch skills update`.
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
      const reason = overwriteReason(installedVersion);
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

// Identify files --force would overwrite; treats unmanaged and unreadable
// files as clobbers requiring confirmation.
export const planForcedClobbers = (skills: BundledSkill[], root: string): ForcedClobber[] => {
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

// Plan uninstall without touching disk; only removes bundle-managed files.
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
 * Executes a confirmed uninstall plan, returning what actually happened: a
 * refused removal comes back as a failed skip rather than throwing and
 * stranding the caller with no record of which files were already gone.
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

// Update installed skills; marker version distinguishes stale installs
// from user edits (overwrite only with --force).
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

function overwriteReason(installedVersion: string | undefined): string {
  if (installedVersion === undefined) return "differs from the bundle; pass --force to overwrite";
  if (installedVersion !== SKILLS_BUNDLE_VERSION) {
    return `installed from bundle v${installedVersion}; run \`langwatch skills update\` (or pass --force to overwrite)`;
  }
  return "locally modified; pass --force to overwrite";
}
