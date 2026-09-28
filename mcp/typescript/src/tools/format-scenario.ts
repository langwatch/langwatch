import type { ScenarioFieldValues } from "../schemas/suite-fields.js";

/** The digest lines for the values a scenario carries per suite field. */
export function formatScenarioFields(
  fields: ScenarioFieldValues | undefined,
): string[] {
  if (!fields || Object.keys(fields).length === 0) return [];
  return [
    "\n## Fields",
    ...Object.entries(fields).map(
      ([identifier, value]) => `- ${identifier}: ${JSON.stringify(value)}`,
    ),
  ];
}
