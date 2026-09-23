import type { LangWatchQLProtections } from "@langwatch/analytics-contract";

/**
 * The strictest protections across a readable project set: a content category is offered only
 * when every project in the set grants it, and an empty set offers nothing (fail-closed).
 * @see specs/lwql/api.feature — the query door redacts to the strictest protection
 */
export function strictestLangWatchQLProtections(
  perProject: readonly LangWatchQLProtections[],
): LangWatchQLProtections {
  const everyProjectGrants = (category: keyof LangWatchQLProtections): boolean =>
    perProject.length > 0 && perProject.every((protections) => protections[category] === true);

  return {
    canSeeCosts: everyProjectGrants("canSeeCosts"),
    canSeeCapturedInput: everyProjectGrants("canSeeCapturedInput"),
    canSeeCapturedOutput: everyProjectGrants("canSeeCapturedOutput"),
  };
}
