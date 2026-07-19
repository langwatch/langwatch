/**
 * `langwatch skills uninstall [names...] [--all] [--dir] [--dry-run] [-y]`
 * — remove installed skills. Only files the bundle manages are ever removed
 * (byte-identical installs, or files carrying the managed-by marker; a
 * modified managed file additionally needs -y). Files a user wrote or
 * another installer placed stay put.
 *
 * Confirmation mirrors gcx: a TTY is asked before anything is deleted; a
 * non-TTY/agent caller is NEVER prompted — without -y it gets a structured
 * error instead, because a blocked prompt reads to a script as a hang.
 */
import * as readline from "node:readline";
import {
  printResult,
  resolveOutputOptions,
  type RawOutputFlags,
} from "../../utils/output";
import {
  applyUninstall,
  planUninstall,
  resolveSkillsRoot,
  SKILLS_BUNDLE_VERSION,
} from "./installer";
import { renderSkillFileResults, resolveTargets, throwValidationError } from "./shared";

export interface SkillsUninstallOptions extends RawOutputFlags {
  /** Uninstall every skill in the bundle. */
  all?: boolean;
  /** Install root (default ~/.agents). */
  dir?: string;
  /** Report what would happen without removing anything. */
  dryRun?: boolean;
  /** Skip the confirmation prompt (required in non-TTY/agent contexts). */
  yes?: boolean;
}

const confirmRemoval = async (question: string): Promise<boolean> => {
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

export const skillsUninstallCommand = async (
  names: string[],
  options: SkillsUninstallOptions = {},
): Promise<void> => {
  const root = resolveSkillsRoot(options.dir);
  const dryRun = options.dryRun === true;
  const yes = options.yes === true;
  const targets = resolveTargets(names, { all: options.all });

  const results = targets.map((skill) => planUninstall(skill, root, { yes }));
  const removals = results.filter((result) => result.action === "removed");

  // Interactive confirmation is for humans at a terminal ONLY. A TTY stdin
  // does not make prompting safe: with `-o json`/`--jq`/`--agent` (or agent
  // env vars) the caller is a machine — a prompt blocks it like a hang, and
  // the pre-confirmation preview would corrupt the structured document it is
  // about to read. Machine callers get the -y error instead, always.
  const resolved = resolveOutputOptions({ ...options });
  const interactive = process.stdin.isTTY === true && resolved.format === "table" && !resolved.agent;

  let confirmed = false;
  if (removals.length > 0 && !yes && !dryRun) {
    if (!interactive) {
      return throwValidationError(
        `uninstall would remove ${removals.length} file${removals.length === 1 ? "" : "s"} and needs confirmation. Re-run with -y (non-interactive callers are never prompted).`,
        { removals: removals.map((result) => result.path) },
      );
    }
    renderSkillFileResults(results);
    const ok = await confirmRemoval("Remove these files?");
    if (!ok) {
      console.log("Aborted. Nothing was removed.");
      return;
    }
    confirmed = true;
  }

  applyUninstall(results, { dryRun });

  await printResult(
    { dir: root, bundleVersion: SKILLS_BUNDLE_VERSION, dryRun, results },
    {
      ...options,
      table: () => {
        // The confirmed path already printed the list as the prompt preview —
        // rendering it again would say the same thing twice.
        if (!confirmed) renderSkillFileResults(results, { dryRun });
      },
    },
  );
};
