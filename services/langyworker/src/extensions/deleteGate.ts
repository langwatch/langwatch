/**
 * Langy's worker-side delete gate: a pre-execution veto that holds every
 * destructive LangWatch command until a genuine, freshly-given, correctly-bound
 * user confirmation is on record.
 *
 * Threat-model boundary (issue #7608, AC 24), quoted verbatim from the spec
 * header (`specs/langy/langy-delete-gate.feature`):
 *
 *   "This worker-side gate is defense-in-depth against accidental and
 *   naively-injected deletes; it is not a guarantee against an adversarial
 *   agent with repo write access, for which only a server-side confirmation
 *   token at the credential boundary suffices."
 *
 * The gate registers on pi's `tool_call` event, which fires BEFORE a tool
 * executes and whose result can veto the call
 * (`agent-session.js:_installAgentToolHooks`). The runtime FAILS CLOSED on a
 * handler throw (`agent-session.js:223-243` re-throws an `Error` verbatim,
 * blocking execution), so a crash here holds the tool rather than releasing it.
 *
 * Responsibilities are split three ways:
 *  - `deleteGateMatcher.ts`  — command → destructive operations (fail-closed).
 *  - `deleteGateConfirmation.ts` — branch history → bound, fresh confirmation.
 *  - this module — compose the two into one veto and register the extension.
 */

import type {
  ExtensionAPI,
  InlineExtension,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import {
  findDestructiveMatches,
  GATED_TOOL_NAMES,
  targetKey,
} from "./deleteGateMatcher.js";
import {
  confirmationSignature,
  resolveConfirmedTargets,
  type BranchEntryLike,
} from "./deleteGateConfirmation.js";

/**
 * `allow: true` may carry a `confirmationSignature` when the release was
 * authorized by a user confirmation. The extension uses it as a transient,
 * in-flight single-use guard: two destructive calls in one parallel prepare
 * wave (before either tool result lands) resolve the SAME unconsumed
 * confirmation, so both would otherwise be released. Branch history remains the
 * source of truth for single-use across turns; this only dedups within a wave.
 */
export type GateDecision =
  | { allow: true; confirmationSignature?: string }
  | { allow: false; reason: string };

/** Tool inputs whose written content is scanned for a destructive command. */
const WRITE_TOOL_NAMES = new Set(["write", "edit"]);

const BLOCK_REASON =
  "Blocked: this command deletes LangWatch data and no confirmation from the user is on record. " +
  "Do not retry it. Tell the user exactly what would be deleted and ask them to confirm, then run it " +
  "only after they answer.";

const UNRESOLVABLE_REASON =
  "Blocked: this command could not be checked for a destructive LangWatch operation (shell substitution, " +
  "an unrecognised wrapper, unbalanced quotes, or executing a file this gate cannot read). Re-issue it as a " +
  "single plain `langwatch` command with no substitutions and no wrapper script so it can be checked.";

const OBFUSCATED_NAME_REASON =
  "Blocked: the command name is obfuscated by quote, backslash, or brace splicing (for example " +
  "`lang\"\"watch`, `lang\\watch`, or `lang{,}watch`), so it could not be checked for a destructive LangWatch " +
  "operation. Re-issue it with the command name written plainly — no quotes, backslashes, or braces splitting " +
  "it — so it can be checked.";

const HTTP_REASON =
  "Blocked: this destructive request cannot be authorized as a raw HTTP call to the LangWatch API — a " +
  "confirmation cannot bind to a curl/HTTP request, so confirming and retrying the same call will keep " +
  "looping. Re-issue it as a plain `langwatch` CLI command, which the user can then confirm.";

const WRITE_THEN_EXEC_REASON =
  "Blocked: this file content contains a destructive LangWatch command, which would run unchecked once the " +
  "file is executed. Re-issue the destructive step as a single plain `langwatch` command instead of writing " +
  "it to a file to run.";

/** Concatenate the text a `write`/`edit` tool call would put on disk. */
function extractWrittenText(input: Record<string, unknown>): string {
  const parts: string[] = [];
  const content = input.content;
  if (typeof content === "string") parts.push(content);
  const edits = input.edits;
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (edit && typeof edit === "object") {
        const newText = (edit as { newText?: unknown }).newText;
        if (typeof newText === "string") parts.push(newText);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Evaluate one tool call. Any ambiguity resolves to a block.
 *
 * @param toolName - the tool about to run.
 * @param input - its arguments, unvalidated.
 * @param entries - the session branch, for the confirmation check.
 */
export function evaluateToolCall({
  toolName,
  input,
  entries,
}: {
  toolName: string;
  input: unknown;
  entries: readonly BranchEntryLike[];
}): GateDecision {
  if (!(GATED_TOOL_NAMES as readonly string[]).includes(toolName)) return { allow: true };

  if (input === null || typeof input !== "object") {
    return { allow: false, reason: UNRESOLVABLE_REASON };
  }
  const record = input as Record<string, unknown>;

  // Write-then-execute: a `write`/`edit` whose content carries a destructive
  // command is held UNCONDITIONALLY — the shell would resolve the file the gate
  // never sees, so no confirmation can release it.
  if (WRITE_TOOL_NAMES.has(toolName)) {
    const written = extractWrittenText(record);
    // `exec-file` covers an interpreter invocation embedded in the content
    // (`python3 -c "...langwatch delete..."`), whose destructive intent is
    // lexically unresolvable — so written content carrying one is held just as
    // a plain `cli-verb`/`http` command would be.
    const embedded = findDestructiveMatches(written).some(
      (match) =>
        match.kind === "cli-verb" || match.kind === "http" || match.kind === "exec-file",
    );
    return embedded ? { allow: false, reason: WRITE_THEN_EXEC_REASON } : { allow: true };
  }

  const command = record.command;
  if (typeof command !== "string") {
    return { allow: false, reason: UNRESOLVABLE_REASON };
  }

  const matches = findDestructiveMatches(command);
  if (matches.length === 0) return { allow: true };

  // Unresolvable kinds are held before the confirmation check ever runs, and no
  // confirmation can release them (write-then-exec / agent-written file). Where
  // the classifier knows the specific cause — an obfuscated/spliced command
  // name — surface a targeted reason so the agent fixes the right thing instead
  // of guessing among the generic four causes.
  if (matches.some((match) => match.kind === "unparseable" || match.kind === "exec-file")) {
    const obfuscatedName = matches.some(
      (match) => match.kind === "unparseable" && match.cause === "obfuscated-command-name",
    );
    return {
      allow: false,
      reason: obfuscatedName ? OBFUSCATED_NAME_REASON : UNRESOLVABLE_REASON,
    };
  }

  // A destructive HTTP call carries no bindable (resource-type, identifier), so
  // it can never match a confirmation. Its reason must NOT tell the user to
  // confirm the curl (that loops); it says to re-issue through the CLI, where a
  // confirmation can bind it.
  if (matches.some((match) => match.kind === "http")) {
    return { allow: false, reason: HTTP_REASON };
  }

  // Every destructive CLI segment must be authorized by a bound confirmation —
  // a multi-target command with one target unconfirmed is blocked entirely.
  const confirmed = resolveConfirmedTargets(entries);
  for (const match of matches) {
    if (match.kind !== "cli-verb") continue;
    if (!match.target || !confirmed.has(targetKey(match.target))) {
      return { allow: false, reason: BLOCK_REASON };
    }
  }
  // Confirmation-backed release: tag it with the confirmation's signature so the
  // extension can enforce single-use within one parallel prepare wave.
  return { allow: true, confirmationSignature: confirmationSignature(entries) };
}

/**
 * The inline extension registered by `createLangySession` when the delete gate
 * is enabled. The handler never throws on its own, but a throw would also block
 * (`agent-session.js:223-243`), so the fail-closed posture holds either way —
 * including when `getBranch()` throws and history is unreadable.
 */
export function createDeleteGateExtension(): InlineExtension {
  return {
    name: "langy-delete-gate",
    factory: (pi: ExtensionAPI) => {
      // Inert-today fail-closed backstop for the parallel-dispatch race, NOT
      // load-bearing under the shipped configuration. `session.ts` pins
      // `toolExecution: "sequential"`, which interleaves prepare→execute→persist
      // per call (pi-agent-core agent-loop.js:295-331), so the first delete's
      // tool result is already in `getBranch()` — marking the confirmation
      // consumed — before the second call's gate runs: branch history alone
      // blocks the reuse, and this Set never fires. It exists solely to keep the
      // gate fail-closed if that setting is ever lost or defaults back to
      // `"parallel"` (agent-loop.js:332-370, `executeToolCallsParallel`), where
      // both calls in a wave would see the same unconsumed confirmation. It
      // records each released signature within the process; once a tool result
      // lands a fresh confirmation yields a different signature, so it never
      // false-blocks a legitimately new confirmation. Branch history stays the
      // source of truth for single-use across turns. (The raw-event integration
      // test drives two tool_call events with no result between them, bypassing
      // sequential dispatch, so it exercises this backstop directly.)
      const releasedConfirmationSignatures = new Set<string>();
      pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult> => {
        let entries: BranchEntryLike[] = [];
        try {
          entries = ctx.sessionManager.getBranch() as BranchEntryLike[];
        } catch {
          // History unreadable: we cannot establish consent, so we do not grant it.
          entries = [];
        }
        const decision = evaluateToolCall({
          toolName: event.toolName,
          input: event.input,
          entries,
        });
        if (!decision.allow) return { block: true, reason: decision.reason };
        if (decision.confirmationSignature !== undefined) {
          if (releasedConfirmationSignatures.has(decision.confirmationSignature)) {
            // A second destructive call authorized by the SAME still-unconsumed
            // confirmation in one prepare wave: single-use forbids it.
            return { block: true, reason: BLOCK_REASON };
          }
          releasedConfirmationSignatures.add(decision.confirmationSignature);
        }
        return {};
      });
    },
  };
}
