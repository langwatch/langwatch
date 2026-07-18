/**
 * `langwatch skills install [names...] [--all] [--dir] [--dry-run] [--force]`
 * — write bundle skills to <root>/skills/<slug>/SKILL.md (recipes nested
 * under recipes/<slug>/), default root ~/.agents. Differing existing files
 * are left alone unless --force; every file action is reported as structured
 * data via printResult.
 */
import { printResult, type RawOutputFlags } from "../../utils/output";
import {
  installSkill,
  resolveSkillsRoot,
  SKILLS_BUNDLE_VERSION,
} from "./installer";
import { renderSkillFileResults, resolveTargets } from "./shared";

export interface SkillsInstallOptions extends RawOutputFlags {
  /** Install every skill in the bundle. */
  all?: boolean;
  /** Install root (default ~/.agents). */
  dir?: string;
  /** Report what would happen without writing anything. */
  dryRun?: boolean;
  /** Overwrite files that differ from the bundle. */
  force?: boolean;
}

export const skillsInstallCommand = async (
  names: string[],
  options: SkillsInstallOptions = {},
): Promise<void> => {
  const root = resolveSkillsRoot(options.dir);
  const targets = resolveTargets(names, { all: options.all });
  const dryRun = options.dryRun === true;

  const results = targets.map((skill) =>
    installSkill(skill, root, { dryRun, force: options.force }),
  );

  await printResult(
    { dir: root, bundleVersion: SKILLS_BUNDLE_VERSION, dryRun, results },
    {
      ...options,
      table: () => renderSkillFileResults(results, { dryRun }),
    },
  );
};
