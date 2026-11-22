// Uninstall only bundle-managed skills; requires confirmation (-y for non-TTY).
import { printResult, type RawOutputFlags } from "../../utils/output";
import {
  applyUninstall,
  planUninstall,
  resolveSkillsRoot,
  SKILLS_BUNDLE_VERSION,
} from "./installer";
import { confirm, isInteractiveConsole, renderSkillFileResults, resolveTargets } from "./shared";
import { throwValidationError } from "./validation";

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

export const skillsUninstallCommand = async (
  names: string[],
  options: SkillsUninstallOptions = {},
): Promise<void> => {
  const root = resolveSkillsRoot(options.dir);
  const dryRun = options.dryRun === true;
  const yes = options.yes === true;
  const targets = resolveTargets({ names, all: options.all });

  const results = targets.map((skill) => planUninstall({ skill, root, yes }));
  const removals = results.filter((result) => result.action === "removed");

  let confirmed = false;
  if (removals.length > 0 && !yes && !dryRun) {
    if (!isInteractiveConsole(options)) {
      return throwValidationError(
        `uninstall would remove ${removals.length} file${removals.length === 1 ? "" : "s"} and needs confirmation. Re-run with -y (non-interactive callers are never prompted).`,
        { removals: removals.map((result) => result.path) },
      );
    }
    renderSkillFileResults({ results });
    const ok = await confirm("Remove these files?");
    if (!ok) {
      console.log("Aborted. Nothing was removed.");
      return;
    }
    confirmed = true;
  }

  const applied = applyUninstall({ results, dryRun });
  const failures = applied.filter((result) => result.failed);

  await printResult(
    { dir: root, bundleVersion: SKILLS_BUNDLE_VERSION, dryRun, results: applied },
    {
      ...options,
      table: () => {
        // The confirmed path already printed the list as the prompt preview —
        // rendering it again would say the same thing twice. A file the
        // filesystem then refused is news, though, so those are always shown.
        if (!confirmed) renderSkillFileResults({ results: applied, dryRun });
        else if (failures.length > 0) renderSkillFileResults({ results: failures });
      },
    },
  );

  // Non-zero only AFTER the report: the caller needs to know which files were
  // removed even when one of them could not be.
  if (failures.length > 0) process.exitCode = 1;
};
