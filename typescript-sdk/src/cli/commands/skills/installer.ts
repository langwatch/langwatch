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
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SKILLS_BUNDLE,
  SKILLS_BUNDLE_VERSION,
  type BundledSkill,
} from "@/internal/generated/cli/skills.generated";

export { SKILLS_BUNDLE, SKILLS_BUNDLE_VERSION, type BundledSkill };

/** The install root: --dir when given, else ~/.agents. */
export const resolveSkillsRoot = (dir?: string): string =>
  dir !== undefined ? path.resolve(dir) : path.join(os.homedir(), ".agents");

/** The marker every installed file ends with (bundle version included). */
export const MANAGED_MARKER = `<!-- managed-by: langwatch-skills v${SKILLS_BUNDLE_VERSION} -->`;

/** Matches the marker from ANY bundle version, so older installs stay managed. */
const MANAGED_MARKER_RE = /<!-- managed-by: langwatch-skills v(\S+?) -->/;

export const skillFilePath = (root: string, skill: BundledSkill): string =>
  path.join(
    root,
    "skills",
    ...(skill.isRecipe ? ["recipes", skill.slug] : [skill.slug]),
    "SKILL.md",
  );

/** The exact file content `install` writes: skill body + managed-by marker. */
export const renderSkillFile = (skill: BundledSkill): string =>
  `${skill.body.trimEnd()}\n\n${MANAGED_MARKER}\n`;

const isManagedContent = (content: string): boolean =>
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
}

const writeSkill = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
};

/**
 * Install one skill: create when missing, leave identical files alone, and
 * refuse to overwrite a differing file unless --force was passed (gcx
 * semantics — a differing file may be the user's own edit or another
 * installer's work). A file we manage from an OLDER bundle is pointed at
 * `langwatch skills update`, the intended path for it.
 */
export const installSkill = (
  skill: BundledSkill,
  root: string,
  { dryRun = false, force = false }: { dryRun?: boolean; force?: boolean },
): SkillFileResult => {
  const filePath = skillFilePath(root, skill);
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
};

/**
 * Plan an uninstall without touching the disk, so the command can ask for
 * confirmation (or refuse, non-TTY) before anything is removed.
 *
 * Only files the bundle manages are ever removed: byte-identical installs,
 * or marker-carrying files — a modified managed file additionally needs -y
 * (it may carry the user's edits). A file with no marker and different
 * content is not ours; it stays.
 */
export const planUninstall = (
  skill: BundledSkill,
  root: string,
  { yes = false }: { yes?: boolean } = {},
): SkillFileResult => {
  const filePath = skillFilePath(root, skill);
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
};

/** Execute a confirmed uninstall plan. */
export const applyUninstall = (
  results: SkillFileResult[],
  { dryRun = false }: { dryRun?: boolean } = {},
): void => {
  if (dryRun) return;
  for (const result of results) {
    if (result.action === "removed") fs.rmSync(result.path, { force: true });
  }
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
export const updateSkill = (
  skill: BundledSkill,
  root: string,
  { dryRun = false, force = false }: { dryRun?: boolean; force?: boolean } = {},
): SkillFileResult => {
  const filePath = skillFilePath(root, skill);
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
};
