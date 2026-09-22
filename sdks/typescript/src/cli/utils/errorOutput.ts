/**
 * Error output: prose for humans, JSON for machines.
 * Both paths scrub messages through `redactSecrets` first; meta/reasons/kind are not scrubbed.
 */
import chalk from "chalk";
import {
  handledErrorFromThrown,
  toCliErrorDocument,
  type CliHandledError,
} from "@langwatch/langy-contract/cards/handled-error";
import { redactSecrets } from "../telemetry/events";
import { withFallbackSuggestions } from "./errorSuggestions";
import { currentOutputScope, getOutputFormat, resolveOutputFormat } from "./outputScope";

/**
 * Re-exported from ./outputScope (chalk-free) to avoid cold-start impact.
 */
export {
  currentOutputScope,
  getOutputFormat,
  resolveOutputFormat,
  setOutputFormat,
  withOutputScope,
  type CliOutputFormat,
} from "./outputScope";

/**
 * Turn colour off for agent mode. Inside a daemon scope, uses a flag;
 * outside, mutates chalk.level directly (only one command in flight).
 */
export const disableOutputColor = (): void => {
  const scope = currentOutputScope();
  if (scope) scope.hasColor = false;
  else chalk.level = 0;
};

/**
 * Message scrubbed only (via redactSecrets); meta/kind/reasons are curated platform payload.
 * Asymmetry is deliberate: credentials leak via message prose, not via structured fields.
 */
export const readCommandError = (error: unknown): CliHandledError => {
  const domain = handledErrorFromThrown(error);
  return { ...domain, message: redactSecrets(domain.message) };
};

const reasonDetailLines = (domain: CliHandledError): [string, string][] => {
  if (!domain.reasons?.length) {
    return [];
  }

  const details: [string, string][] = [
    ["caused by", domain.reasons.map((r) => r.kind).join(" → ")],
  ];

  for (const reason of domain.reasons) {
    const field = reason.meta?.field;
    const message = reason.meta?.message;
    if (typeof message !== "string" || !message) continue;
    details.push([typeof field === "string" && field ? field : reason.kind, message]);
  }

  return details;
};

/** `code` / `trace id` / meta keys, aligned into a dim block under `Details:`. */
const detailLines = (domain: CliHandledError): string[] => {
  const details: [string, string][] = [["code", domain.code]];

  if (domain.httpStatus > 0) {
    details.push(["status", String(domain.httpStatus)]);
  }
  if (domain.traceId) {
    details.push(["trace id", domain.traceId]);
  }
  if (domain.traceUrl) {
    details.push(["trace url", domain.traceUrl]);
  }

  // Printed as the platform composed it. See `readCommandError` on why `meta` is
  // NOT scrubbed: it is curated, secret-free by contract, and the scrub would eat
  // the very identifiers the user is reading the error to find.
  for (const [key, value] of Object.entries(domain.meta)) {
    if (value === null || value === undefined) continue;
    const rendered = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    if (!rendered) continue;
    details.push([key, rendered]);
  }

  details.push(...reasonDetailLines(domain));

  const width = Math.max(...details.map(([key]) => key.length));

  return [
    "Details:",
    ...details.map(([key, value]) => `  ${chalk.dim(key.padEnd(width))}  ${chalk.dim(value)}`),
  ];
};

/**
 * Human rendering: Error sentence, Details, Suggestions (platform or fallback), Docs.
 * Infrastructure failures print sentence only (no invented precision).
 */
export const renderErrorForHumans = (domain: CliHandledError): string => {
  if (!domain.isHandled) return domain.message;

  const enriched = withFallbackSuggestions(domain);
  const lines = [`Error: ${enriched.message}`, ...detailLines(enriched)];

  if (enriched.suggestions?.length) {
    lines.push("Suggestions:", ...enriched.suggestions.map((suggestion) => `  - ${suggestion}`));
  }
  if (enriched.docUrl) {
    lines.push(`Docs: ${enriched.docUrl}`);
  }

  return lines.join("\n");
};

/**
 * Machine rendering: JSON on stdout. Fallback suggestions filled even for unhandled errors
 * (isHandled: false signals code source); human gets sentence only (no invented precision).
 */
export const renderErrorAsJson = (domain: CliHandledError): string =>
  JSON.stringify(
    toCliErrorDocument(withFallbackSuggestions(domain)),
    null,
    // Agent mode's contract is compact single-line JSON (utils/output.ts);
    // the pretty two-space form is for `-o json`, where a person may read it.
    getOutputFormat() === "agents" ? 0 : 2,
  );

/**
 * Local validation error with SDK brand so handledErrorFromThrown recognizes it as already read.
 */
export const commandValidationError = (
  message: string,
  meta: Record<string, unknown> = {},
): CliHandledError & { isLangWatchHandledError: true } => ({
  isLangWatchHandledError: true,
  code: "validation_error",
  kind: "validation_error",
  message,
  httpStatus: 0,
  meta,
  isHandled: true,
  retryable: false,
});

/**
 * A local "sign in first" failure the CLI checked itself, so `httpStatus` is 0:
 * without its own code a missing login reads as `network_error`, whose advice
 * has nothing to do with the precondition that failed.
 */
export const commandAuthError = (
  message: string,
  meta: Record<string, unknown> = {},
): CliHandledError & { isLangWatchHandledError: true } => ({
  isLangWatchHandledError: true,
  code: "not_authenticated",
  kind: "not_authenticated",
  message,
  httpStatus: 0,
  meta,
  isHandled: true,
  retryable: false,
});

/**
 * Report failure from no-spinner path (validation, credentials, preconditions).
 * Human block or JSON + single line, depending on format. Does not exit.
 */
export const reportCommandError = ({
  error,
  format,
}: {
  error: unknown;
  /** Explicit format override; defaults to the running command's format. */
  format?: string;
}): void => {
  const domain = readCommandError(error);
  const wantsJson = resolveOutputFormat(format) !== "text";

  if (wantsJson) {
    console.log(renderErrorAsJson(domain));
    console.error(chalk.red(domain.message));
    return;
  }

  console.error(chalk.red(renderErrorForHumans(domain)));
};
