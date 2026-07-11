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
 *   default        a red line on STDERR, then the kind, the trace id and the
 *                  meta, indented under it. Nothing on stdout.
 *   --format json  the structured document on STDOUT — `{ ok: false, error:
 *                  { kind, message, httpStatus, meta, traceId, reasons } }` —
 *                  and the one-line human summary still on stderr, where it
 *                  cannot corrupt what the parser reads.
 *
 * Both paths run every string through `redactSecrets` first. An API key echoed
 * back inside a 404 message is a real thing servers do, and it must not reach a
 * terminal, a log, or an agent's context.
 */
import chalk from "chalk";
import {
  domainErrorFromThrown,
  toCliErrorDocument,
  type CliDomainError,
} from "@langwatch/cli-cards/domain-error";
import { redactSecrets } from "../telemetry/events";

/** The output format a command was invoked with. */
export type CliOutputFormat = "json" | "text";

/**
 * The format of the command CURRENTLY running.
 *
 * Module state, set once per invocation by the `preAction` hook in `program.ts`,
 * because the ~100 `failSpinner` call sites should not each have to remember to
 * thread an option through to be able to fail correctly — forgetting would mean
 * a command that silently prints prose to a parser. Written on EVERY action (not
 * only when `--format` is passed) so a daemon serving one command after another
 * cannot leak a `json` from the last caller into the next one.
 */
let currentFormat: CliOutputFormat = "text";

export const setOutputFormat = (format: string | undefined): void => {
  currentFormat = format === "json" ? "json" : "text";
};

export const getOutputFormat = (): CliOutputFormat => currentFormat;

/**
 * The format to render a failure in: what the caller explicitly said, else what
 * the running command was invoked with. The explicit argument wins so a command
 * that already holds its own `--format` (and a test that passes one) does not
 * depend on the program hook having run.
 */
export const resolveOutputFormat = (
  explicit?: string,
): CliOutputFormat =>
  explicit === undefined ? currentFormat : explicit === "json" ? "json" : "text";

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
 * platform composes for a user, an agent or the UI to act on, and the domain-error
 * contract is that nothing internal or secret goes in them (see the content rule
 * on `server/app-layer/langy/errors.ts`). Scrubbing them would not add safety —
 * it would destroy the actionable data this whole feature exists to surface,
 * because the credential patterns match legitimate identifiers too: a `vk-…`
 * virtual-key id or an `lw-…` handle in `meta` would come out as `[redacted]`
 * and the user would be left staring at the redaction instead of the id they
 * needed.
 */
export const readCommandError = (error: unknown): CliDomainError => {
  const domain = domainErrorFromThrown(error);
  return { ...domain, message: redactSecrets(domain.message) };
};

/** `kind` / `trace id` / meta keys, aligned into a dim block under the message. */
const detailLines = (domain: CliDomainError): string[] => {
  const details: [string, string][] = [["kind", domain.kind]];

  if (domain.httpStatus > 0) {
    details.push(["status", String(domain.httpStatus)]);
  }
  if (domain.traceId) {
    details.push(["trace id", domain.traceId]);
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

  return details.map(
    ([key, value]) => `  ${chalk.dim(key.padEnd(width))}  ${chalk.dim(value)}`,
  );
};

/**
 * The human rendering: the sentence, then everything else that was on the error.
 *
 * An INFRASTRUCTURE failure prints the sentence alone. Its "kind" is a label the
 * CLI invented for a failure the platform never named (`internal_error`,
 * `network_error`), and dressing that up as though the platform had said it
 * would be inventing precision that does not exist.
 */
export const renderErrorForHumans = (domain: CliDomainError): string => {
  if (!domain.isDomain) return domain.message;
  return [domain.message, ...detailLines(domain)].join("\n");
};

/** The machine rendering: one JSON document, and nothing else, on stdout. */
export const renderErrorAsJson = (domain: CliDomainError): string =>
  JSON.stringify(toCliErrorDocument(domain), null, 2);
