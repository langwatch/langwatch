/**
 * `langwatch skills update [names...] [--dir] [--dry-run]` — refresh
 * installed skills whose content differs from the bundle (e.g. after the CLI
 * itself was upgraded to a newer bundle). Only managed files are
 * overwritten; with no names, every installed skill is a candidate.
 */
import * as fs from "node:fs";
import { printResult, type RawOutputFlags } from "../../utils/output";
import {
  resolveSkillsRoot,
  skillFilePath,
  updateSkill,
  SKILLS_BUNDLE,
  SKILLS_BUNDLE_VERSION,
} from "./installer";
import { renderSkillFileResults, resolveTargets } from "./shared";

export interface SkillsUpdateOptions extends RawOutputFlags {
  /** Install root (default ~/.agents). */
  dir?: string;
  /** Report what would happen without writing anything. */
  dryRun?: boolean;
  /** Overwrite managed files that carry local edits. */
  force?: boolean;
}

export const skillsUpdateCommand = async (
  names: string[],
  options: SkillsUpdateOptions = {},
): Promise<void> => {
  const root = resolveSkillsRoot(options.dir);
  const dryRun = options.dryRun === true;

  // No names: every INSTALLED bundle skill is a candidate — update never
  // installs anything new (that is `install`'s job).
  const targets =
    names.length > 0
      ? resolveTargets(names, {})
      : SKILLS_BUNDLE.filter((skill) =>
          fs.existsSync(skillFilePath(root, skill)),
        );

  const results = targets.map((skill) =>
    updateSkill(skill, root, { dryRun, force: options.force }),
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
        renderSkillFileResults(results, { dryRun });
      },
    },
  );
};
