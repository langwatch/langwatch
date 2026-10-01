/**
 * Extract variable names from an HTTP body template.
 * @param bodyTemplate - The body template string with mustache variables
 * @returns Array of unique variable names found in the template
 */
export const extractVariablesFromBodyTemplate = (bodyTemplate: string | undefined): string[] => {
  if (!bodyTemplate) return [];

  const pattern = /\{\{(\w+)\}\}/g;
  const variables = new Set<string>();
  for (let match = pattern.exec(bodyTemplate); match !== null; match = pattern.exec(bodyTemplate)) {
    variables.add(match[1]!);
  }

  return Array.from(variables);
};
