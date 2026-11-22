/**
 * Print skill's SKILL.md body raw by default; structured document for
 * explicit format requests.
 */
import { hasExplicitFormatRequest, printResult, type RawOutputFlags } from "../../utils/output";
import { findSkill, SKILLS_BUNDLE } from "./installer";
import { throwValidationError } from "./validation";

export const skillsGetCommand = async (
  name: string,
  options: RawOutputFlags = {},
): Promise<void> => {
  const skill = findSkill(name);
  if (!skill) {
    return throwValidationError(
      `Unknown skill "${name}". Run \`langwatch skills list\` to see the bundle.`,
      {
        available: SKILLS_BUNDLE.map((entry) =>
          entry.isRecipe ? `recipes/${entry.slug}` : entry.slug,
        ),
      },
    );
  }

  if (hasExplicitFormatRequest(options)) {
    await printResult(
      {
        slug: skill.isRecipe ? `recipes/${skill.slug}` : skill.slug,
        name: skill.name,
        description: skill.description,
        ...(skill.userPrompt !== undefined ? { userPrompt: skill.userPrompt } : {}),
        body: skill.body,
      },
      { ...options, table: () => process.stdout.write(skill.body) },
    );
    return;
  }

  process.stdout.write(skill.body);
};
