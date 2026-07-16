/**
 * The CLI envelope: re-typing a shell tool call as the LangWatch capability it
 * really was.
 *
 * Langy runs on opencode and reaches LangWatch through the `langwatch` CLI, so
 * every tool call arrives named `bash` with the intent buried in a command
 * string. Left alone that flattens the product: the durable event log records
 * "the agent ran bash" instead of "the agent searched traces", and the browser
 * has nothing to key a card off.
 *
 * This service is the one place that translation happens. It sits at the very
 * top of the turn processor's tool handling, BEFORE anything is recorded, so a
 * single rewrite reaches every consumer downstream:
 *
 *     bash("langwatch trace search --format json | jq .")
 *       -> name:   langwatch.trace.search      (durable event + live buffer)
 *       -> output: {"traces":[…],"pagination":…}  (the document, not the console)
 *
 * Nothing after this point knows a shell was involved.
 *
 * It owns the POLICY — which tools are shells, where the command lives in a tool
 * input, when an output is worth reducing. The two grammars it depends on are
 * separate, pure modules: `langwatchCommand` (shell string -> resource + verb)
 * and `cliJson` (noisy stdout -> the JSON document).
 *
 * @see specs/langy/langy-cli-tool-envelope.feature
 * @see src/features/langy/components/capabilities/capabilityRegistry.ts — the
 *      other half: `langwatch.<resource>.<verb>` -> the card that renders it.
 */
import {
  extractDigest,
  cliToolResultSchema,
  parseCliJson,
  toCliTextResult,
  toCliToolResult,
  cliToolResultPayload,
  type CliResultDigest,
  type CliToolResult,
} from "@langwatch/cli-cards";
import {
  parseLangwatchCommand,
  type LangwatchCommand,
} from "./langwatchCommand";

/**
 * A tool-call lifecycle frame the manager forwards from opencode (`langy.tool`).
 * `phase:"start"` carries the tool name + input; `phase:"end"` carries the
 * result (`output`, a string) and whether it errored. Paired by `id`.
 *
 * `digest` is never on the wire — it is COMPUTED here on a successful end
 * frame: the compact reference (ids, query, counts) the card hydrates fresh
 * data from, so the stored output only ever has to be the fallback.
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
   * Re-type a tool frame that is really a LangWatch CLI call. Everything else —
   * a real shell command, a file edit, a frame whose stdout held no document —
   * is returned unchanged (identity, not a copy), so the caller can treat this
   * as a transparent pass-through.
   */
  normalizeToolFrame({ frame }: { frame: LangyToolFrame }): LangyToolFrame {
    const command = this.shellCommandOf(frame);
    if (!command) return frame;

    const invocation = parseLangwatchCommand(command);
    if (!invocation) return frame;

    const name = this.toolNameOf(invocation);
    if (frame.phase === "start") return { ...frame, name };

    // A failed call's output is an error message, not a document — keep it as
    // the CLI wrote it so the error card shows what the user would have seen.
    if (frame.isError) return { ...frame, name };

    // Future workers can emit the canonical value directly. Validate it again
    // at this trust boundary, then retain exactly that value rather than parsing
    // a parallel string representation and risking the two drifting apart.
    const supplied = cliToolResultSchema.safeParse(frame.result);
    if (supplied.success) {
      const digest = extractDigest({
        resource: invocation.resource,
        verb: invocation.verb,
        args: invocation.args,
        output: frame.output ?? "",
      });
      return {
        ...frame,
        name,
        output: JSON.stringify(cliToolResultPayload(supplied.data)),
        digest,
        result: supplied.data,
      };
    }

    if (frame.output === undefined) return { ...frame, name };

    // The digest is the reference the card hydrates from (ids, the parsed
    // flags as its query, honest counts); the reduced output stays alongside
    // as the fallback tier and the agent-history record.
    const document = parseCliJson(frame.output);
    const digest = extractDigest({
      resource: invocation.resource,
      verb: invocation.verb,
      args: invocation.args,
      output: document ?? frame.output,
    });

    if (document === null) {
      const result = toCliTextResult(frame.output);
      return {
        ...frame,
        name,
        output: JSON.stringify(result),
        digest,
        result,
      };
    }

    const result = toCliToolResult({
      resource: invocation.resource,
      verb: invocation.verb,
      payload: document,
    });
    // Re-stringified because a frame's `output` is a string all the way to the
    // browser; the card parses it back into the structure it renders.
    return {
      ...frame,
      name,
    // AI-SDK tool parts only carry `output`; serialising the union here keeps
      // live streaming and durable replay on the exact same contract.
      output: JSON.stringify(cliToolResultPayload(result)),
      digest,
      result,
    };
  }

  /** The stable, typed tool name a CLI call is recorded under. */
  toolNameOf({ resource, verb }: LangwatchCommand): string {
    return `langwatch.${resource}.${verb}`;
  }

  /**
   * The command string behind a shell tool call, or null when the frame is not a
   * shell call at all. opencode's bash tool passes `{ command: "…" }`, but the
   * input is whatever the model produced, so a bare string is tolerated too.
   */
  /**
   * The shell command a tool frame is carrying, or null when the frame is not a
   * shell call. Public because it is the ONE place that knows which tools are
   * shells and where a command hides in a tool input — the turn processor reuses
   * it to spot the agent reaching for GitHub (`needsGithubAuth`) rather than
   * re-deriving that knowledge and letting the two drift.
   */
  shellCommandOf(frame: LangyToolFrame): string | null {
    if (!SHELL_TOOL_NAMES.has(frame.name.trim().toLowerCase())) return null;

    const { input } = frame;
    if (typeof input === "string") return input.trim() ? input : null;
    if (!input || typeof input !== "object") return null;

    const record = input as Record<string, unknown>;
    for (const key of COMMAND_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return null;
  }
}
