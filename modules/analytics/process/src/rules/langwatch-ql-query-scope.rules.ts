import type { LangWatchQLProtections } from "@langwatch/analytics-contract";

/**
 * The strictest protections across a readable project set: a content category or a catalogue
 * permission is offered only when every project in the set grants it; an empty set offers nothing.
 * @see specs/lwql/api.feature — the query door redacts to the strictest protection
 */
export function strictestLangWatchQLProtections(
  perProject: readonly LangWatchQLProtections[],
): LangWatchQLProtections {
  type Category = "canSeeCosts" | "canSeeCapturedInput" | "canSeeCapturedOutput";
  const everyProjectGrants = (category: Category): boolean =>
    perProject.length > 0 && perProject.every((protections) => protections[category] === true);
  const [first, ...rest] = perProject;
  const permissions = (first?.catalogue.permissions ?? []).filter((permission) =>
    rest.every((protections) => protections.catalogue.permissions.includes(permission)),
  );

  return {
    canSeeCosts: everyProjectGrants("canSeeCosts"),
    canSeeCapturedInput: everyProjectGrants("canSeeCapturedInput"),
    canSeeCapturedOutput: everyProjectGrants("canSeeCapturedOutput"),
    catalogue: { permissions },
  };
}
