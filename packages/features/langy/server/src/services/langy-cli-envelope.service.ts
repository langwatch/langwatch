/**
 * The CLI envelope: re-typing a shell tool call as the LangWatch capability it really was.
 * @see specs/langy/langy-cli-tool-envelope.feature
 * @see src/features/langy/components/capabilities/capabilityRegistry.ts — the
 */
import {
  type CliResultDigest,
  type CliToolResult,
  cliToolResultSchema,
  extractDigest,
  parseCliJson,
  readCliErrorDocument,
  toCliErrorDocument,
  toCliTextResult,
  toCliToolResult,
} from "@langwatch/langy-contract";
import { type LangwatchCommand, parseLangwatchCommand } from "@langwatch/langy-contract";

/**
 * A tool-call lifecycle frame the manager forwards from opencode (`langy.tool`). `phase:"start"`
 * carries the tool name + input; `phase:"end"` carries the result (`output`, a string) and whether
 * it errored. Paired by `id`.
 */
export interface LangyToolFrame {
  id: string;
  name: string;
  phase: "start" | "end";
  title?: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
  digest?: CliResultDigest;
  /** Validated polymorphic payload for a successful LangWatch CLI call. */
  result?: CliToolResult;
}

/** opencode's shell tools — any of these may be carrying a `langwatch` call. */
const SHELL_TOOL_NAMES = new Set(["bash", "shell", "execute"]);

/** Keys a shell tool may pass its command under. opencode's bash uses `command`. */
const COMMAND_KEYS = ["command", "cmd", "script"];

export class LangyCliEnvelopeService {
  static create(): LangyCliEnvelopeService {
    return new LangyCliEnvelopeService();
  }

  /**
   * Re-type a tool frame that is really a LangWatch CLI call. Everything else — a real shell
   * command, a file edit, a frame whose stdout held no document — is returned unchanged (identity,
   * not a copy), so the caller can treat this as a transparent pass-through.
   */
  normalizeToolFrame({ frame }: { frame: LangyToolFrame }): LangyToolFrame {
    const command = this.tryShellCommandOf(frame);
    if (!command) {
      return frame;
    }

    const invocation = parseLangwatchCommand(command);
    if (!invocation) {
      return frame;
    }

    const name = this.toolNameOf(invocation);
    if (frame.phase === "start") {
      return { ...frame, name };
    }

    if (frame.isError) {
      return this.retypeWorkerFailure({ frame, name });
    }

    const supplied = this.retypeSuppliedResult({ frame, invocation, name });
    if (supplied) {
      return supplied;
    }

    if (frame.output === undefined) {
      return { ...frame, name };
    }

    return this.retypeStdout({ frame, invocation, name, output: frame.output });
  }

  /**
   * A failed call still printed its failure document: the CLI writes it to stdout and a one-line
   * human summary to stderr, then exits non-zero. Passing the frame through gave the card
   * whichever the worker put in `output`, losing every scrap of structure when that was stderr.
   */
  private retypeWorkerFailure({
    frame,
    name,
  }: {
    frame: LangyToolFrame;
    name: string;
  }): LangyToolFrame {
    const reported = readCliErrorDocument(parseCliJson(frame.output ?? "") ?? frame.output);

    return reported
      ? { ...frame, name, output: JSON.stringify(toCliErrorDocument(reported)) }
      : { ...frame, name };
  }

  /**
   * The canonical value a future worker can emit directly. It is validated again at this trust
   * boundary and then retained exactly, rather than parsing a parallel string representation and
   * risking the two drifting apart. Null when the frame carries no such value.
   */
  private retypeSuppliedResult({
    frame,
    invocation,
    name,
  }: {
    frame: LangyToolFrame;
    invocation: LangwatchCommand;
    name: string;
  }): LangyToolFrame | null {
    const supplied = cliToolResultSchema.safeParse(frame.result);
    if (!supplied.success) {
      return null;
    }

    return {
      ...frame,
      name,
      output: JSON.stringify(supplied.data),
      digest: this.digestOf({ invocation, output: frame.output ?? "" }),
      result: supplied.data,
    };
  }

  /**
   * The frame re-typed from what the call printed. A command writing an error document to stdout
   * and exiting cleanly is a failure the worker never noticed, so it is recognised here rather
   * than falling through to the success path and rendering as a wall of JSON.
   */
  private retypeStdout({
    frame,
    invocation,
    name,
    output,
  }: {
    frame: LangyToolFrame;
    invocation: LangwatchCommand;
    name: string;
    output: string;
  }): LangyToolFrame {
    const document = parseCliJson(output);
    const reported = readCliErrorDocument(document ?? output);
    if (reported) {
      // The failure document, whole: the card renders its sentence and next steps structurally,
      // and keeping only the message discarded the code, meta and tips sent for that consumer.
      return {
        ...frame,
        name,
        isError: true,
        output: JSON.stringify(toCliErrorDocument(reported)),
      };
    }

    const digest = this.digestOf({ invocation, output: document ?? output });
    const result =
      document === null
        ? toCliTextResult(output)
        : toCliToolResult({
            resource: invocation.resource,
            verb: invocation.verb,
            payload: document,
          });

    // A frame's `output` is a string all the way to the browser, and the card parses it back into
    // the structure it renders; serialising here keeps streaming and replay on one contract.
    return { ...frame, name, output: JSON.stringify(result), digest, result };
  }

  /** The reference the card hydrates from: ids, the parsed flags as its query, honest counts. */
  private digestOf({
    invocation,
    output,
  }: {
    invocation: LangwatchCommand;
    output: unknown;
  }): CliResultDigest {
    return extractDigest({
      resource: invocation.resource,
      verb: invocation.verb,
      args: invocation.args,
      output,
    });
  }

  /** The stable, typed tool name a CLI call is recorded under. */
  toolNameOf({ resource, verb }: LangwatchCommand): string {
    return `langwatch.${resource}.${verb}`;
  }

  /**
   * The shell command a tool frame is carrying, or null when the frame is not
   * a shell call. Public because it is the ONE place that knows which tools
   * are shells and where a command hides in a tool input.
   */
  tryShellCommandOf(frame: LangyToolFrame): string | null {
    if (!SHELL_TOOL_NAMES.has(frame.name.trim().toLowerCase())) {
      return null;
    }

    const { input } = frame;
    if (typeof input === "string") {
      return input.trim() ? input : null;
    }

    if (!input || typeof input !== "object") {
      return null;
    }

    const record = input as Record<string, unknown>;
    for (const key of COMMAND_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    return null;
  }
}
