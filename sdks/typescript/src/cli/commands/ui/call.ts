import { readFile } from "node:fs/promises";
import { handledErrorFrom } from "@/internal/api/errors";
import { resolveCredentials } from "../../utils/apiKey";
import { reportCommandError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";

/**
 * Bound the request so a wedged control plane cannot hold the whole turn.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * True of EVERY failed dispatch, whichever way it failed.
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
 * Dispatch one typed UI action to the page the user has open, and print the result
 * (specs/langy/langy-ui-actions.feature).
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
    process.stderr.write("Pass either --payload or --payload-file, not both.\n");
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
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
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
    response = await fetch(`${endpoint}/api/v1/langy/ui/actions`, {
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
    // Through the shared reporter, not straight to stderr. The body is the platform's REST
    // envelope (`{error: {...}}`), and the reader on the other end — the panel's tool card —
    // parses the CLI's own failure document (`{ok: false, error: {...}}`).
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
