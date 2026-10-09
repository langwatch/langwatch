import { resolveErrorCopy } from "~/features/errors";

/**
 * The words a stood-down control carries, for the code the route would refuse
 * with.
 *
 * One function, two surfaces — the addresses list and the sign-in-methods list
 * both grey out a control the detach guard would refuse — so the tooltip on
 * one cannot start saying something the other does not. The words themselves
 * are the registry's, keyed by the code: nothing here writes copy.
 */
export function refusalCopy(code: string): string {
  const copy = resolveErrorCopy({ error: { error: code } });
  return copy.description ? `${copy.title}. ${copy.description}` : copy.title;
}
