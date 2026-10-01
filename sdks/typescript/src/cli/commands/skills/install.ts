// Install bundle skills to ~/.agents/skills/; --force overwrites with confirmation.
import { printResult, type RawOutputFlags } from "../../utils/output";
import {
  installSkill,
  planForcedClobbers,
  resolveSkillsRoot,
  SKILLS_BUNDLE_VERSION,
} from "./installer";
import {
  announceRoot,
  confirmForcedOverwrite,
  renderSkillFileResults,
  resolveTargets,
} from "./shared";

export interface SkillsInstallOptions extends RawOutputFlags {
  /** Install every skill in the bundle. */
  all?: boolean;
  /** Install root (default ~/.agents). */
  dir?: string;
  /** Report what would happen without writing anything. */
  dryRun?: boolean;
  /** Overwrite files that differ from the bundle. */
  force?: boolean;
  /** Skip the --force confirmation (required in non-TTY/agent contexts). */
  yes?: boolean;
}

export const skillsInstallCommand = async (
  names: string[],
  options: SkillsInstallOptions = {},
): Promise<void> => {
  const root = resolveSkillsRoot(options.dir);
  const targets = resolveTargets({ names, all: options.all });
  const dryRun = options.dryRun === true;
  const force = options.force === true;

  announceRoot(root, options);

  if (force) {
    const proceed = await confirmForcedOverwrite(planForcedClobbers(targets, root), {
      yes: options.yes === true,
      dryRun,
      options,
    });
    if (!proceed) {
      console.log("Aborted. Nothing was written.");
      return;
    }
  }

  const results = targets.map((skill) => installSkill({ skill, root, dryRun, force }));

  await printResult(
    { dir: root, bundleVersion: SKILLS_BUNDLE_VERSION, dryRun, results },
    {
      ...options,
      table: () => renderSkillFileResults({ results, dryRun }),
    },
  );

  // Non-zero only AFTER the report: the caller needs to know which files
  // changed even when one of them could not be written.
  if (results.some((result) => result.failed)) process.exitCode = 1;
};
