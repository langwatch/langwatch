/**
 * Shared plumbing for `langwatch skills` mutating commands: name-to-skill
 * resolution (loud on typos), the per-file result list rendering, and the
 * one confirmation gate every destructive path goes through.
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
 * the named ones. Unknown names fail loudly with the valid set in `meta` --
 * a silent no-op would let an agent believe a skill exists on disk.
 */
export const resolveTargets = ({
  names,
  all = false,
}: {
  names: string[];
  all?: boolean;
}): BundledSkill[] => {
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
export const renderSkillFileResults = ({
  results,
  dryRun = false,
}: {
  results: SkillFileResult[];
  dryRun?: boolean;
}): void => {
  for (const result of results) {
    const action = (dryRun ? DRY_RUN_ACTION[result.action] : undefined) ?? result.action;
    const color = ACTION_COLOR[result.action];
    const reason = result.reason !== undefined ? chalk.gray(` — ${result.reason}`) : "";
    console.log(`  ${color(action.padEnd(14))}${result.path}${reason}`);
  }
};

/** Whether this command's output is the human table (never a parsed document). */
const isTableOutput = (options: RawOutputFlags): boolean =>
  resolveOutputOptions({ ...options }).format === "table";

// Safe to prompt only on TTY with table format, never with structured output.
export const isInteractiveConsole = (options: RawOutputFlags): boolean => {
  const resolved = resolveOutputOptions({ ...options });
  return process.stdin.isTTY === true && resolved.format === "table" && !resolved.agent;
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

// Gate --force to demand confirmation for non-managed files; our own stay frictionless.
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
  return confirm("Overwrite these files?");
};
