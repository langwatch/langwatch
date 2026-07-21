/**
 * Shared plumbing for the `langwatch skills` mutating commands: turning name
 * arguments into bundle skills (with a loud error on typos), the human
 * rendering of the per-file result list, and the one confirmation gate every
 * destructive path goes through.
 */
import * as readline from "node:readline";
import chalk from "chalk";
import { resolveOutputOptions, type RawOutputFlags } from "../../utils/output";
import {
  resolveSkills,
  SKILLS_BUNDLE,
  type BundledSkill,
  type ForcedClobber,
  type SkillFileResult,
} from "./installer";
import { throwValidationError } from "./validation";

/**
 * The skills a mutating command acts on: the whole bundle with --all, else
 * the named ones. Unknown names fail loudly with the valid set in `meta` —
 * a silent no-op install is how an agent ends up believing a skill exists
 * on disk when nothing was ever written.
 */
export const resolveTargets = (
  names: string[],
  { all = false }: { all?: boolean },
): BundledSkill[] => {
  if (all) return [...SKILLS_BUNDLE];
  if (names.length === 0) {
    return throwValidationError(
      "No skills named. Pass skill names or --all (see `langwatch skills list`).",
    );
  }
  const { skills, unknown } = resolveSkills(names);
  if (unknown.length > 0) {
    return throwValidationError(
      `Unknown skill${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Run \`langwatch skills list\` to see the bundle.`,
      {
        unknown,
        available: SKILLS_BUNDLE.map((entry) =>
          entry.isRecipe ? `recipes/${entry.slug}` : entry.slug,
        ),
      },
    );
  }
  return skills;
};

const ACTION_COLOR: Record<SkillFileResult["action"], (text: string) => string> = {
  created: chalk.green,
  updated: chalk.green,
  removed: chalk.red,
  unchanged: chalk.gray,
  skipped: chalk.yellow,
};

/** Dry-run spells an action as intent: created → would-create, and so on. */
const DRY_RUN_ACTION: Partial<Record<SkillFileResult["action"], string>> = {
  created: "would-create",
  updated: "would-update",
  removed: "would-remove",
};

/** The human form of a per-file result list (`-o json` never reaches this). */
export const renderSkillFileResults = (
  results: SkillFileResult[],
  { dryRun = false }: { dryRun?: boolean } = {},
): void => {
  for (const result of results) {
    const action =
      (dryRun ? DRY_RUN_ACTION[result.action] : undefined) ?? result.action;
    const color = ACTION_COLOR[result.action];
    const reason = result.reason !== undefined ? chalk.gray(` — ${result.reason}`) : "";
    console.log(`  ${color(action.padEnd(14))}${result.path}${reason}`);
  }
};

/** Whether this command's output is the human table (never a parsed document). */
const isTableOutput = (options: RawOutputFlags): boolean =>
  resolveOutputOptions({ ...options }).format === "table";

/**
 * Whether it is safe to PROMPT.
 *
 * Interactive confirmation is for humans at a terminal ONLY. A TTY stdin does
 * not make prompting safe: with `-o json`/`--jq`/`--agent` (or agent env vars)
 * the caller is a machine — a prompt blocks it like a hang, and the
 * pre-confirmation preview would corrupt the structured document it is about
 * to read. Machine callers get a -y/--yes error instead, always.
 */
export const isInteractiveConsole = (options: RawOutputFlags): boolean => {
  const resolved = resolveOutputOptions({ ...options });
  return (
    process.stdin.isTTY === true && resolved.format === "table" && !resolved.agent
  );
};

/** Ask a yes/no question on the terminal. Only ever called when interactive. */
export const confirm = async (question: string): Promise<boolean> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} [y/N] `, (a) => resolve(a));
  });
  rl.close();
  const norm = answer.trim().toLowerCase();
  return norm === "y" || norm === "yes";
};

/** Say which root is about to be written to, before anything is written. */
export const announceRoot = (root: string, options: RawOutputFlags): void => {
  if (isTableOutput(options)) console.log(chalk.gray(`Install root: ${root}`));
};

/**
 * The `--force` gate: the same confirmation `uninstall` demands, applied to
 * the strictly MORE destructive act of truncating a file.
 *
 * `uninstall` refuses non-interactively without -y before removing a file it
 * has already proven it owns; `--force` used to overwrite files it has proven
 * it does NOT own, with no prompt and no TTY check at all. This closes that,
 * and only that: clobbers here are files carrying content we did not write, so
 * forcing over our own installs stays frictionless.
 *
 * Returns whether to proceed; throws (never prompts) for machine callers.
 */
export const confirmForcedOverwrite = async (
  clobbers: ForcedClobber[],
  {
    yes = false,
    dryRun = false,
    options = {},
  }: { yes?: boolean; dryRun?: boolean; options?: RawOutputFlags } = {},
): Promise<boolean> => {
  if (clobbers.length === 0) return true;

  const plural = clobbers.length === 1 ? "" : "s";
  if (isTableOutput(options)) {
    console.log(
      chalk.yellow(
        `--force will overwrite ${clobbers.length} file${plural} not managed by \`langwatch skills\`:`,
      ),
    );
    for (const clobber of clobbers) console.log(`  ${chalk.red(clobber.path)}`);
  }

  if (dryRun || yes) return true;

  if (!isInteractiveConsole(options)) {
    return throwValidationError(
      `--force would overwrite ${clobbers.length} file${plural} not managed by \`langwatch skills\` and needs confirmation. Re-run with -y (non-interactive callers are never prompted).`,
      { clobbers: clobbers.map((clobber) => clobber.path) },
    );
  }
  return await confirm("Overwrite these files?");
};
