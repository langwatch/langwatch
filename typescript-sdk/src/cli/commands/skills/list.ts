/**
 * `langwatch skills list` — every skill in the embedded bundle with its
 * installed state at the target root (default ~/.agents).
 */
import * as fs from "node:fs";
import chalk from "chalk";
import { printResult, type RawOutputFlags } from "../../utils/output";
import { formatTable } from "../../utils/formatting";
import {
  resolveSkillsRoot,
  skillFilePath,
  SKILLS_BUNDLE,
  SKILLS_BUNDLE_VERSION,
} from "./installer";

export interface SkillsListOptions extends RawOutputFlags {
  /** Install root to check (default ~/.agents). */
  dir?: string;
}

export const skillsListCommand = async (
  options: SkillsListOptions = {},
): Promise<void> => {
  const root = resolveSkillsRoot(options.dir);
  const skills = SKILLS_BUNDLE.map((skill) => ({
    slug: skill.isRecipe ? `recipes/${skill.slug}` : skill.slug,
    description: skill.description,
    installed: fs.existsSync(skillFilePath({ root, skill })),
  }));

  await printResult(
    { dir: root, bundleVersion: SKILLS_BUNDLE_VERSION, skills },
    {
      ...options,
      table: () => {
        formatTable({
          data: skills.map((row) => ({
            SLUG: row.slug,
            INSTALLED: row.installed ? chalk.green("yes") : "—",
            DESCRIPTION: row.description,
          })),
          headers: ["SLUG", "INSTALLED", "DESCRIPTION"],
          colorMap: { SLUG: chalk.cyan },
        });
        console.log(
          chalk.gray(`\nInstall root: ${root} (bundle v${SKILLS_BUNDLE_VERSION})`),
        );
      },
    },
  );
};
