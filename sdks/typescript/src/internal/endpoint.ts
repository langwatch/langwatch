/**
 * Single place where a configured LangWatch endpoint becomes a usable base URL.
 */

import { DEFAULT_ENDPOINT } from "./constants";

const isSet = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * Trim surrounding whitespace and drop any trailing slashes.
 */
export const normalizeEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "/") end--;
  return trimmed.slice(0, end);
};

/**
 * Resolve the endpoint from an explicit value, then `LANGWATCH_ENDPOINT`, then the cloud
 * default. Blank values are treated as unset so that an empty `LANGWATCH_ENDPOINT=` in a
 * `.env` falls through to the default rather than producing relative request URLs.
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
 * The OTLP logs endpoint an environment asks for, per the OTel exporter spec: the
 * signal-specific variable wins and is used verbatim; the generic variable is a base that
 * `/v1/logs` hangs off.
 */
export const resolveLogsEndpoint = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const signal = env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim();
  if (signal) return signal;

  const generic = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (generic) return `${normalizeEndpoint(generic)}/v1/logs`;

  return null;
};
