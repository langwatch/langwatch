/**
 * `langwatch skills update [names...] [--dir] [--dry-run]` — refresh
 * installed skills whose content differs from the bundle (e.g. after the CLI
 * itself was upgraded to a newer bundle). Only managed files are
 * overwritten; with no names, every installed skill is a candidate.
 */
import * as fs from "node:fs";
import { printResult, type RawOutputFlags } from "../../utils/output";
import {
  planForcedClobbers,
  resolveSkillsRoot,
  skillFilePath,
  updateSkill,
  SKILLS_BUNDLE,
  SKILLS_BUNDLE_VERSION,
} from "./installer";
import {
  announceRoot,
  confirmForcedOverwrite,
  renderSkillFileResults,
  resolveTargets,
} from "./shared";

export interface SkillsUpdateOptions extends RawOutputFlags {
  /** Install root (default ~/.agents). */
  dir?: string;
  /** Report what would happen without writing anything. */
  dryRun?: boolean;
  /** Overwrite managed files that carry local edits. */
  force?: boolean;
  /** Skip the --force confirmation (required in non-TTY/agent contexts). */
  yes?: boolean;
}

export const skillsUpdateCommand = async (
  names: string[],
  options: SkillsUpdateOptions = {},
): Promise<void> => {
  const root = resolveSkillsRoot(options.dir);
  const dryRun = options.dryRun === true;
  const force = options.force === true;

  // No names: every INSTALLED bundle skill is a candidate — update never
  // installs anything new (that is `install`'s job).
  const targets =
    names.length > 0
      ? resolveTargets({ names })
      : SKILLS_BUNDLE.filter((skill) =>
          fs.existsSync(skillFilePath({ root, skill })),
        );

  announceRoot(root, options);

  // `update` already refuses unmanaged files on its own, so this gate is
  // normally a no-op — it is here so that the ONE rule ("--force never
  // destroys content we did not write without confirmation") holds for every
  // forcing path, not just the one that happens to need it today.
  if (force) {
    const proceed = await confirmForcedOverwrite(
      planForcedClobbers(targets, root),
      { yes: options.yes === true, dryRun, options },
    );
    if (!proceed) {
      console.log("Aborted. Nothing was written.");
      return;
    }
  }

  const results = targets.map((skill) =>
    updateSkill({ skill, root, dryRun, force }),
  );

  await printResult(
    { dir: root, bundleVersion: SKILLS_BUNDLE_VERSION, dryRun, results },
    {
      ...options,
      table: () => {
        if (targets.length === 0) {
          console.log("No installed skills found. Run `langwatch skills install --all`.");
          return;
        }
        renderSkillFileResults({ results, dryRun });
      },
    },
  );

  // Non-zero only AFTER the report: the caller needs to know which files
  // changed even when one of them could not be written.
  if (results.some((result) => result.failed)) process.exitCode = 1;
};
