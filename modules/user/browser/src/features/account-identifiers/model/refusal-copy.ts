import { explainAnyError } from "@langwatch/error-presentation/presentation";

/** The registry's words for the code the route would refuse with, for a stood-down control. */
export function refusalCopy(code: string): string {
  const copy = explainAnyError({ error: { code } });
  return copy.description ? `${copy.title}. ${copy.description}` : copy.title;
}
