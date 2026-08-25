import { readFile } from "node:fs/promises";
import { handledErrorFrom } from "@/internal/api/errors";
import { resolveCredentials } from "../../utils/apiKey";
import { reportCommandError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";

/**
 * Bound the request so a wedged control plane cannot hold the whole turn.
 *
 * This call blocks by design: the server keeps it open for the claim window
 * (3s) plus the action's execute budget, which the platform caps at 30s. 60s
 * clears that ceiling with room to spare, so a slow page still answers here
 * while a half-open socket fails instead of hanging the agent worker.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * True of EVERY failed dispatch, whichever way it failed.
 *
 * The page claims the action and carries it out before it answers, so a
 * failure here is only ever the ANSWER going missing: the column may already
 * be there. Retrying blind is what turns one duplicate into two, and it is the
 * obvious move for a caller told nothing else. It has to be said on the server
 * failures too, not only on the local deadline: a 504 from the dispatch is the
 * page taking longer than its budget, which is exactly the case where the work
 * did land.
 */
const MAY_HAVE_APPLIED =
  "The action may still have applied: read the state again before you retry.";

/** Everything on stdin, for `--payload-file -`. */
const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

/**
 * The cause is kept: a missing file, a directory and a permission denial all
 * need a different fix, and an agent told only "could not read" cannot tell
 * which one it hit.
 */
const readPayloadFile = async (file: string): Promise<string> => {
  if (file === "-") return await readStdin();
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read the payload file ${file}: ${cause}`);
  }
};

/**
 * Dispatch one typed UI action to the page the user has open, and print the
 * result (specs/langy/langy-ui-actions.feature).
 *
 * This command only works while an agent turn is running: the control plane
 * publishes the action on that turn's live stream, the open page claims and
 * executes it, and the result comes back in this same HTTP call. Run
 * standalone in a terminal there is no turn and no page, and the server
 * answers `langy_ui_turn_inactive`.
 *
 * The payload is opaque here on purpose — the server owns the action schemas
 * (`langwatch ui actions` prints them) and refuses anything that does not
 * parse, so this command never has to track them.
 *
 * `--payload-file` exists because the payloads that matter carry prose. A
 * prompt draft has apostrophes in it, and one apostrophe ends the shell's
 * single-quoted argument: the rest of the prompt then arrives as separate
 * arguments, the command refuses them, and the edit is lost. A file (or `-`
 * for stdin) never passes through the shell's quoting at all.
 */
export const uiCallCommand = async (
  kind: string,
  options: {
    payload?: string;
    payloadFile?: string;
    experiment?: string;
    /** The caller's `--format`, so a refusal answers in the shape they asked for. */
    format?: string;
  },
): Promise<CommandResult | void> => {
  const { apiKey, endpoint } = await resolveCredentials();

  const conversationId = process.env.LANGY_CONVERSATION_ID;
  if (!conversationId) {
    process.stderr.write(
      "ui call needs LANGY_CONVERSATION_ID in the environment. It is set for agent workers; outside one there is no page to drive.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (options.payload && options.payloadFile) {
    // Picking one silently would apply a payload the caller did not name, and
    // this command writes to the page the user is watching.
    process.stderr.write(
      "Pass either --payload or --payload-file, not both.\n",
    );
    process.exitCode = 1;
    return;
  }

  let payload: unknown = {};
  const source = options.payloadFile
    ? { flag: "--payload-file", read: () => readPayloadFile(options.payloadFile!) }
    : options.payload
      ? { flag: "--payload", read: async () => options.payload! }
      : null;
  if (source) {
    let raw: string;
    try {
      raw = await source.read();
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      return;
    }
    try {
      payload = JSON.parse(raw);
    } catch {
      process.stderr.write(`${source.flag} is not valid JSON\n`);
      process.exitCode = 1;
      return;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${endpoint}/api/langy/ui/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify({
        conversationId,
        kind,
        payload,
        // Names the experiment a backend fallback applies the action to when no
        // page answers. The open page never needs it.
        ...(options.experiment ? { experimentSlug: options.experiment } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A tripped deadline rejects with a bare TimeoutError, which reads as a
    // crash rather than as the limit this command set. Name it. Every other
    // failure is left to the caller's error path.
    if ((error as { name?: string } | null)?.name !== "TimeoutError") throw error;
    process.stderr.write(
      `${endpoint} did not answer "${kind}" within ${REQUEST_TIMEOUT_MS / 1000}s. ` +
        `${MAY_HAVE_APPLIED}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const text = await response.text();
  if (!response.ok) {
    // Through the shared reporter, not straight to stderr. The body is the
    // platform's REST envelope (`{error: {...}}`), and the reader on the other
    // end — the panel's tool card — parses the CLI's own failure document
    // (`{ok: false, error: {...}}`). Written raw, the card could not read it
    // and showed the customer the wire envelope: a wall of escaped JSON under
    // "This step couldn't be completed", with the sentence explaining the
    // failure buried in the middle of it.
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    reportCommandError({
      error:
        handledErrorFrom({
          operation: `ui call ${kind}`,
          body,
          status: response.status,
        }) ?? new Error(text),
      ...(options.format ? { format: options.format } : {}),
    });
    process.stderr.write(`${MAY_HAVE_APPLIED}\n`);
    process.exitCode = 1;
    return;
  }
  return asCommandResult(text);
};

/**
 * Hand the server's answer to the output contract without reshaping it.
 *
 * The action result is the server's document, so `data` is the parsed body and
 * `-o json|yaml|agents`, `--json` and `--jq` all project from it. The human
 * form stays the exact bytes the server sent, which is what an agent reading
 * the default output already expects.
 */
export const asCommandResult = (text: string): CommandResult | void => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    process.stderr.write(`The server answered a body that is not JSON:\n${text}\n`);
    process.exitCode = 1;
    return;
  }
  return {
    data,
    table: () => {
      console.log(text);
    },
  };
};
