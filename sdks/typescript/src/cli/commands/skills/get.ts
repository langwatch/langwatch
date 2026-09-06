/**
 * `langwatch skills get <name>` — print a skill's body, raw, on stdout.
 * Agents pipe this straight into their context, so the default output is the
 * SKILL.md content itself in BOTH human and auto-detected agent mode (same
 * precedent as `help-tree`); any EXPLICIT machine request (`-o json|agents|
 * yaml`, `--json`, `--jq`, `-f json`) returns the skill as a structured
 * document instead — an explicit `-o agents` is a request for compact JSON,
 * not for the raw body an agent caller would have gotten anyway.
 */
import {
  hasExplicitFormatRequest,
  printResult,
  type RawOutputFlags,
} from "../../utils/output";
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
