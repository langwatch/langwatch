/**
 * Single place where a configured LangWatch endpoint becomes a usable base URL.
 *
 * Most services build request URLs by concatenation — `${endpoint}/api/...` —
 * and every path already carries its own leading slash. A trailing slash on the
 * endpoint therefore yields `https://app.langwatch.ai//api/experiment/init`,
 * which the router does not match, and the caller gets an opaque
 * `{"error":"Not Found"}` with nothing pointing at the real cause. Normalizing
 * at the point of resolution keeps every call site free of that concern.
 */

import { DEFAULT_ENDPOINT } from "./constants";

const isSet = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * Trim surrounding whitespace and drop any trailing slashes.
 *
 * Scanned rather than matched with `/\/+$/`: a repeated character class bound
 * to an anchor backtracks from every start index, which is quadratic on a
 * string of many slashes. The endpoint is configuration rather than attacker
 * input, but a linear scan costs nothing and leaves no such edge to reason
 * about.
 */
export const normalizeEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "/") end--;
  return trimmed.slice(0, end);
};

/**
 * Resolve the endpoint from an explicit value, then `LANGWATCH_ENDPOINT`, then
 * the cloud default. Blank values are treated as unset so that an empty
 * `LANGWATCH_ENDPOINT=` in a `.env` falls through to the default rather than
 * producing relative request URLs.
 */
export const resolveEndpoint = (endpoint?: string | null): string => {
  for (const candidate of [endpoint, process.env.LANGWATCH_ENDPOINT]) {
    if (!isSet(candidate)) continue;
    const normalized = normalizeEndpoint(candidate);
    if (normalized !== "") return normalized;
  }
  return normalizeEndpoint(DEFAULT_ENDPOINT);
};
