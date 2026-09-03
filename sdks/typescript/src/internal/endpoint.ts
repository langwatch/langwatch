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

/**
 * The OTLP logs endpoint an environment asks for, per the OTel exporter spec:
 * the signal-specific variable wins and is used verbatim; the generic variable
 * is a base that `/v1/logs` hangs off. Null when neither is set, which means no
 * OTLP transport rather than a default one.
 *
 * It lives here rather than beside either of its callers because both need it
 * and their module graphs must stay apart. The CLI's live event channel loads
 * the OpenTelemetry logs pipeline and the card contract; the session context
 * hook is bundled into a zero-dependency single file that ships inside the
 * agent plugin. Reaching into the event channel for this one pure env read
 * would put the whole telemetry graph in that bundle.
 */
export const resolveLogsEndpoint = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const signal = env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim();
  if (signal) return signal;

  const generic = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (generic) return `${normalizeEndpoint(generic)}/v1/logs`;

  return null;
};
