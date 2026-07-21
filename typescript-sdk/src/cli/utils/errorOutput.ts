/**
 * How a failed command SAYS it failed — once, for every command.
 *
 * A command that fails has two audiences and they want opposite things. A person
 * wants a sentence, and then the details that let them fix it. A machine — Langy
 * runs this CLI in a shell and parses its stdout — wants the structure, and prose
 * is actively in its way: it cannot tell a transient failure from a terminal one
 * by reading English, so it retries both, or neither.
 *
 * So the same failure is rendered twice, by output format, from one reading of
 * the error:
 *
 *   default        a gcx-style block on STDERR — `Error: <sentence>`, then
 *                  `Details:` (code, status, trace id/url, meta, reason chain),
 *                  `Suggestions:` and `Docs:` when there is advice to give.
 *                  Nothing on stdout.
 *   --format json  the structured document on STDOUT — `{ ok: false, error:
 *                  { code, kind, message, httpStatus, meta, traceId, traceUrl,
 *                  reasons, suggestions, docUrl } }` — and the one-line human
 *                  summary still on stderr, where it cannot corrupt what the
 *                  parser reads.
 *
 * Both paths run every string through `redactSecrets` first. An API key echoed
 * back inside a 404 message is a real thing servers do, and it must not reach a
 * terminal, a log, or an agent's context.
 */
import chalk from "chalk";
import {
  handledErrorFromThrown,
  toCliErrorDocument,
  type CliHandledError,
} from "@langwatch/cli-cards/handled-error";
import { redactSecrets } from "../telemetry/events";
import { withFallbackSuggestions } from "./errorSuggestions";
import {
  currentOutputScope,
  getOutputFormat,
  resolveOutputFormat,
} from "./outputScope";

/**
 * The output-context machinery (format + colour scope) lives in
 * `./outputScope`, a chalk-free module, so that `program.ts` can reach it via
 * `utils/output.ts` without putting chalk's ~4ms load on the cold-start path
 * of every in-process invocation. Re-exported here so the existing consumers
 * (spinner.ts, apiKey.ts, daemon/execution.ts, tests) keep their imports.
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
 * Turn colour off for the rest of this command (agent mode).
 *
 * `chalk.level` is a process global that chalk reads at RENDER time, so
 * AsyncLocalStorage cannot scope it: mutating it mid-request would bleed into
 * every other request sharing the daemon's execution window (an agent request
 * would leave a concurrent human caller colourless, and vice versa). Inside a
 * request scope the mutation is therefore replaced by a flag the daemon's
 * output sink honours — daemon/execution.ts strips SGR sequences from that
 * request's bytes, and `chalk.level` is never touched. Outside a scope — a
 * plain in-process run — exactly one command is in flight and setting
 * `chalk.level` directly is both faithful and free.
 *
 * Because this is the one context operation that needs chalk, it stays in
 * this module and `applyOutputContext` (utils/output.ts) reaches it through a
 * lazy import that only runs when agent mode is actually requested.
 */
export const disableOutputColor = (): void => {
  const scope = currentOutputScope();
  if (scope) scope.hasColor = false;
  else chalk.level = 0;
};

/**
 * Read any thrown value into the platform's structure, with the MESSAGE scrubbed.
 *
 * The message is scrubbed and `meta` / `kind` / `reasons` are not, and the
 * asymmetry is deliberate.
 *
 * A message is prose, and prose is where a server echoes your INPUT back at you
 * ("no project for key sk-live-…"). That is the real leak vector, so it goes
 * through `redactSecrets` — the same scrub the telemetry path applies, so a
 * failure reads identically wherever it surfaces.
 *
 * `meta`, `kind` and `reasons` are the opposite: they are a CURATED payload the
 * platform composes for a user, an agent or the UI to act on, and the handled-error
 * contract is that nothing internal or secret goes in them (see the content rule
 * on `server/app-layer/langy/errors.ts`). Scrubbing them would not add safety —
 * it would destroy the actionable data this whole feature exists to surface,
 * because the credential patterns match legitimate identifiers too: a `vk-…`
 * virtual-key id or an `lw-…` handle in `meta` would come out as `[redacted]`
 * and the user would be left staring at the redaction instead of the id they
 * needed.
 */
export const readCommandError = (error: unknown): CliHandledError => {
  const domain = handledErrorFromThrown(error);
  return { ...domain, message: redactSecrets(domain.message) };
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
    const rendered =
      typeof value === "string" ? value : JSON.stringify(value) ?? "";
    if (!rendered) continue;
    details.push([key, rendered]);
  }

  if (domain.reasons?.length) {
    details.push(["caused by", domain.reasons.map((r) => r.kind).join(" → ")]);
  }

  const width = Math.max(...details.map(([key]) => key.length));

  return [
    "Details:",
    ...details.map(
      ([key, value]) => `  ${chalk.dim(key.padEnd(width))}  ${chalk.dim(value)}`,
    ),
  ];
};

/**
 * The human rendering: the sentence, then everything else that was on the error.
 *
 *   Error: <sentence>
 *   Details:
 *     code       dataset_not_found
 *     status     404
 *     trace id   …
 *   Suggestions:
 *     - <next step>
 *   Docs: <docUrl>
 *
 * The Suggestions/Docs sections appear only when there is advice to give —
 * server-sent when the platform sent it, the code-keyed fallback table (see
 * `errorSuggestions.ts`) otherwise.
 *
 * An INFRASTRUCTURE failure prints the sentence alone. Its "code" is a label the
 * CLI invented for a failure the platform never named (`internal_error`,
 * `network_error`), and dressing that up as though the platform had said it
 * would be inventing precision that does not exist.
 */
export const renderErrorForHumans = (domain: CliHandledError): string => {
  if (!domain.isHandled) return domain.message;

  const enriched = withFallbackSuggestions(domain);
  const lines = [`Error: ${enriched.message}`, ...detailLines(enriched)];

  if (enriched.suggestions?.length) {
    lines.push(
      "Suggestions:",
      ...enriched.suggestions.map((suggestion) => `  - ${suggestion}`),
    );
  }
  if (enriched.docUrl) {
    lines.push(`Docs: ${enriched.docUrl}`);
  }

  return lines.join("\n");
};

/**
 * The machine rendering: one JSON document, and nothing else, on stdout.
 * Suggestions/docUrl are filled from the fallback table when the platform sent
 * none, so an agent gets the same way forward a person does.
 *
 * The fallback applies here even for INFRASTRUCTURE errors (`isHandled: false`),
 * and that asymmetry with the human rendering is deliberate. A person gets the
 * bare sentence because dressing a failure the platform never named in
 * CLI-invented detail would fake precision; a machine gets the fallback advice
 * anyway, because the status-derived codes (`network_error`, `internal_error`)
 * are exactly the codes the fallback table has honest, generic guidance for
 * (check connectivity; retry and quote the trace id), and the document still
 * carries `isHandled: false` so the reader knows the code is ours, not the
 * platform's.
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
 * A local argument/precondition failure, pre-shaped so the error path reports
 * it as the `validation_error` it is rather than guessing `network_error` from
 * a bare `Error`. Carries the SDK's `isLangWatchHandledError` brand, which is
 * how `handledErrorFromThrown` recognises an error that has already been read
 * into the domain structure.
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
});

/**
 * Report a failure from a command path that has no spinner — argument
 * validation, missing credentials, filesystem preconditions. The same two
 * renderings `failSpinner` produces, minus the spinner:
 *
 *   default        the human block on stderr.
 *   --format json  the `{ ok: false, error: … }` document on stdout, and a
 *                  single human line on stderr.
 *
 * Does NOT exit — the caller owns its exit code.
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
