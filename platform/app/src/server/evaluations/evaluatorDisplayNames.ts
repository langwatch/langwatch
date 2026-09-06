/**
 * Display names for evaluators whose catalog name is too long or too
 * vendor-specific to show in the UI.
 *
 * Temporary, until evaluations support grouping — at which point these become
 * group labels rather than renames.
 *
 * Lives beside the evaluator catalog (`evaluators.ts`) that both the API and the
 * UI already import, rather than inside the selection component. When the API
 * reached into the component for it, that one import pulled Chakra UI, Ark UI,
 * Emotion, react-dom and react-router into every backend process.
 *
 * @see specs/setup/memory-footprint.feature — "The backend never loads the
 * browser UI stack"
 */
export const evaluatorTempNameMap: Readonly<Record<string, string>> = {
  "Azure Content Safety": "Content Safety",
  "OpenAI Moderation": "Moderation",
  "Azure Jailbreak Detection": "Jailbreak Detection",
  "Presidio PII Detection": "PII Detection",
  "Lingua Language Detection": "Language Detection",
  "Azure Prompt Shield": "Prompt Injection Detection",
} as const;

/**
 * What to call an evaluator on screen: its override if it has one, otherwise
 * the catalog name.
 *
 * Every caller was open-coding `map[name] ?? name`, which meant six copies of
 * the same fallback and six chances to forget it.
 */
export const evaluatorDisplayName = (name: string): string =>
  evaluatorTempNameMap[name] ?? name;
