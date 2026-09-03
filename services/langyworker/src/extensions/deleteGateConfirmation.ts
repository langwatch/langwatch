/**
 * Reads a genuine, freshly-given, correctly-bound user confirmation out of pi
 * session history. Every decision here is derived from the branch on each call
 * (`ctx.sessionManager.getBranch()`), never from gate-local memory, so the gate
 * is stateless across worker restarts and cannot be desynced.
 *
 * Two properties make the confirmation unforgeable by the agent:
 *
 *  - Only `type: "message"` entries with `role: "user"` count. Extension- and
 *    agent-authored messages persist as `custom_message` / `role: "custom"`
 *    (`agent-session.js:1094`, via `appendCustomMessageEntry`) or `assistant`
 *    turns, none of which this reader treats as user speech. That is the
 *    property issue #7562 lacked — a passphrase the agent authored cannot
 *    satisfy the gate, because the agent has no way to author a user turn.
 *  - A resumed turn prepends the PREVIOUS worker's digest — agent-authored
 *    prose — inside the user's own message (`system-prompt.ts`). Confirmation
 *    text is read only from the part AFTER the digest end marker.
 */

import {
  DESTRUCTIVE_VERBS,
  RESOURCE_TYPES,
  type GateTarget,
  targetKey,
} from "./deleteGateMatcher.js";

/** Marker `prependResumeSeed` writes between the digest and the user's words. */
const RESUME_SEED_END_MARKER = "[End of digest. The user's current message follows.]";

/**
 * The subset of a pi `SessionEntry` this gate reads. `type: "message"` carries
 * a role-tagged `message`; other entry types (`custom_message`, `compaction`,
 * …) have no `role: "user"` and are treated as non-user.
 */
export type BranchEntryLike = {
  type?: string;
  message?: { role?: string; content?: unknown } | null;
};

type EntryRole = "user" | "assistant" | "toolResult" | "custom" | "other";

function entryRole(entry: BranchEntryLike): EntryRole {
  if (entry?.type === "message" && entry.message) {
    const role = entry.message.role;
    if (role === "user" || role === "assistant" || role === "toolResult" || role === "custom") {
      return role;
    }
  }
  return "other";
}

/** Flatten pi message content (string, or an array of typed blocks) to text. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
  }
  return parts.join("\n");
}

/**
 * The user's OWN words in a turn, with any prepended resume digest removed.
 * Treating the digest as user speech would re-open exactly the self-authored
 * confirmation hole this gate exists to close.
 */
export function stripResumeSeed(text: string): string {
  const marker = text.lastIndexOf(RESUME_SEED_END_MARKER);
  if (marker === -1) return text;
  return text.slice(marker + RESUME_SEED_END_MARKER.length);
}

/**
 * A confirmation must be short and lead with assent. Long prose that merely
 * contains "yes" is rejected: an affirmative buried in a paragraph is far more
 * likely to be a quote, a plan, or pasted output than a decision.
 */
const AFFIRMATIVE_LEAD =
  /^(yes|yep|yeah|yup|confirm(ed)?|go ahead|do it|proceed|approved?|ok(ay)?|sure|delete it|please delete)\b/i;
const CONFIRMATION_MAX_LENGTH = 200;

/**
 * Even a reply that LEADS with assent is not a confirmation when it trails a
 * question or carries a negation or hedge: "Ok, what does that dataset contain?"
 * and "Yes but NOT d2" both open affirmative yet withhold or narrow consent.
 * Reject on a trailing `?` or any of these words, so a bound "yes" is an
 * unqualified yes to exactly what the ask named.
 */
const NEGATION_OR_HEDGE = /\b(no|not|don't|dont|never|wait|stop|but|except|instead|hold)\b/i;

export function isUserConfirmation(text: string): boolean {
  const own = stripResumeSeed(text).trim();
  if (own.length === 0 || own.length > CONFIRMATION_MAX_LENGTH) return false;
  if (own.endsWith("?") || NEGATION_OR_HEDGE.test(own)) return false;
  return AFFIRMATIVE_LEAD.test(own);
}

const VERB_ALT = [...DESTRUCTIVE_VERBS].join("|");
const TYPE_ALT = [...RESOURCE_TYPES].join("|");
/**
 * Extract the (resource-type, identifier) targets an assistant turn named for
 * deletion: a destructive verb, then a resource-type token, then its
 * identifier, within one clause. Anchored on the verb so it collects only the
 * OBJECT of a delete, never an incidental `dataset list` adjacency — which
 * keeps confirm-A-delete-B falsifiable on both axes.
 */
const ASK_TARGET = new RegExp(
  // The verb is captured (group 1) so the confirmation binds to it: a "yes" to
  // "archive dataset d1" must not authorize a "delete dataset d1". The
  // identifier must END alphanumeric, so a trailing sentence period ("delete
  // dashboard d1.") is not absorbed into the id — otherwise the ask's "d1."
  // would never match the command's "d1".
  `\\b(${VERB_ALT})\\b[^.?!\\n]{0,40}?\\b(${TYPE_ALT})\\b\\s+["']?([A-Za-z0-9](?:[\\w.-]*[A-Za-z0-9])?)["']?`,
  "gi",
);

export function parseAskTargets(text: string): GateTarget[] {
  const targets: GateTarget[] = [];
  for (const match of text.matchAll(ASK_TARGET)) {
    const verb = (match[1] ?? "").toLowerCase();
    const resourceType = (match[2] ?? "").toLowerCase();
    const identifier = match[3] ?? "";
    if (verb && resourceType && identifier) {
      targets.push({ verb, resourceType, identifier });
    }
  }
  return targets;
}

/**
 * The set of (resource-type, identifier) targets a genuine, fresh, unconsumed
 * user confirmation currently authorizes — as `targetKey` strings.
 *
 * The confirming user turn must:
 *  1. be the most recent user message, and be an affirmative lead;
 *  2. immediately follow (as the next message turn) an assistant turn that
 *     named one or more delete targets — an opening "yes" with no ask before it
 *     is not assent to a question never asked;
 *  3. not yet have been acted on: any tool result after it, or any completed
 *     assistant turn after it other than the in-flight tool-calling turn, means
 *     the confirmation is stale or already consumed (single-use).
 *
 * @param entries - `ctx.sessionManager.getBranch()`, oldest first.
 */
export function resolveConfirmedTargets(entries: readonly BranchEntryLike[]): Set<string> {
  const empty = new Set<string>();
  if (!Array.isArray(entries) || entries.length === 0) return empty;

  // The most recent user message, by original index.
  let ui = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry && entryRole(entry) === "user") {
      ui = i;
      break;
    }
  }
  if (ui === -1) return empty;

  const userEntry = entries[ui];
  if (!userEntry || !isUserConfirmation(contentToText(userEntry.message?.content))) return empty;

  // Nothing may have acted on the confirmation since it was given. A tool result
  // after it, or a completed (non-last) assistant turn after it, is a prior
  // action — the confirmation is stale/consumed. The one assistant turn allowed
  // after it is the in-flight tool-calling turn (the last entry).
  const lastIndex = entries.length - 1;
  for (let j = ui + 1; j <= lastIndex; j += 1) {
    const entry = entries[j];
    if (!entry) continue;
    const role = entryRole(entry);
    if (role === "toolResult") return empty;
    if (role === "assistant" && j !== lastIndex) return empty;
  }

  // The confirmation must immediately follow an assistant turn that named a
  // delete. The previous MESSAGE turn (any role) must be that assistant ask.
  let prevMessageIndex = -1;
  for (let j = ui - 1; j >= 0; j -= 1) {
    const entry = entries[j];
    if (entry && entryRole(entry) !== "other") {
      prevMessageIndex = j;
      break;
    }
  }
  if (prevMessageIndex === -1) return empty;
  const askEntry = entries[prevMessageIndex];
  if (!askEntry || entryRole(askEntry) !== "assistant") return empty;

  const confirmed = new Set<string>();
  for (const target of parseAskTargets(contentToText(askEntry.message?.content))) {
    confirmed.add(targetKey(target));
  }
  return confirmed;
}

/**
 * A stable fingerprint of the CURRENT unconsumed confirmation, for the
 * extension's in-flight single-use guard. It combines the branch length with
 * the confirmed target set: two prepare-wave calls that see the same branch
 * (no tool result between them) produce the SAME signature — so the second is
 * blocked — while any appended entry (a tool result, a fresh confirmation)
 * lengthens the append-only branch and yields a different signature. Empty
 * string when nothing is confirmed (never used to gate a non-confirmed allow).
 */
export function confirmationSignature(entries: readonly BranchEntryLike[]): string {
  const confirmed = resolveConfirmedTargets(entries);
  if (confirmed.size === 0) return "";
  const length = Array.isArray(entries) ? entries.length : 0;
  return `${length}|${[...confirmed].sort().join(",")}`;
}
