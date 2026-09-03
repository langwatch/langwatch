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
  resolveConfirmedTargets,
  type BranchEntryLike,
} from "./deleteGateConfirmation.js";

export type { BranchEntryLike } from "./deleteGateConfirmation.js";

export type GateDecision = { allow: true } | { allow: false; reason: string };

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
    const embedded = findDestructiveMatches(written).some(
      (match) => match.kind === "cli-verb" || match.kind === "http",
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
  // confirmation can release them (write-then-exec / agent-written file).
  if (matches.some((match) => match.kind === "unparseable" || match.kind === "exec-file")) {
    return { allow: false, reason: UNRESOLVABLE_REASON };
  }

  // A destructive HTTP call carries no bindable (resource-type, identifier), so
  // it can never match a confirmation. Held with the confirm reason: the agent
  // re-issues it through the CLI, where a confirmation can bind it.
  if (matches.some((match) => match.kind === "http")) {
    return { allow: false, reason: BLOCK_REASON };
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
  return { allow: true };
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
        if (decision.allow) return {};
        return { block: true, reason: decision.reason };
      });
    },
  };
}
