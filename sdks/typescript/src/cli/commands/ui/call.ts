import { readFile } from "node:fs/promises";
import { resolveCredentials } from "../../utils/apiKey";
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

/** Everything on stdin, for `--payload-file -`. */
const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const readPayloadFile = async (file: string): Promise<string> => {
  if (file === "-") return await readStdin();
  try {
    return await readFile(file, "utf8");
  } catch {
    throw new Error(`Could not read the payload file ${file}`);
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
  options: { payload?: string; payloadFile?: string; experiment?: string },
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
    // crash rather than as the limit this command set. Name it, and say the
    // action may still have applied: the next step is to read the state again,
    // not to retry blind. Every other failure is left to the caller's error
    // path.
    if ((error as { name?: string } | null)?.name !== "TimeoutError") throw error;
    process.stderr.write(
      `${endpoint} did not answer "${kind}" within ${REQUEST_TIMEOUT_MS / 1000}s. ` +
        "The action may still have applied: read the state again before you retry.\n",
    );
    process.exitCode = 1;
    return;
  }

  const text = await response.text();
  if (!response.ok) {
    // The body is the canonical handled-error envelope: code, meta, tips.
    // Print it whole so the agent can read the code and act on the tips.
    process.stderr.write(`${text}\n`);
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
