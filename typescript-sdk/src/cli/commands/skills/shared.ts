/**
 * Shared plumbing for the `langwatch skills` mutating commands: turning
 * name arguments into bundle skills (with a loud error on typos) and the
 * human rendering of the per-file result list.
 */
import chalk from "chalk";
import { commandValidationError } from "../../utils/errorOutput";
import {
  resolveSkills,
  SKILLS_BUNDLE,
  type BundledSkill,
  type SkillFileResult,
} from "./installer";

/**
 * Throw a validation failure as a real Error that still carries the domain
 * brand — eslint's only-throw-error demands an Error instance, while
 * `domainErrorFromThrown` recognises the failure by the brand on the thrown
 * value itself (it reads those fields before unwrapping anything).
 *
 * Call it as `return throwValidationError(...)`: a bare call compiles but
 * TypeScript's control-flow analysis does not treat it as exiting the block,
 * so narrowing after it is lost.
 */
export const throwValidationError = (
  message: string,
  meta: Record<string, unknown> = {},
): never => {
  throw Object.assign(new Error(message), commandValidationError(message, meta));
};

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
