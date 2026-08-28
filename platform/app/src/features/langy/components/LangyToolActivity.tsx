/**
 * Tool-call activity for an assistant turn. Everything here is a CARD.
 *
 * The Langy worker streams its CLI/tool calls into the assistant message as
 * AI-SDK tool parts (`tool-<name>` / `dynamic-tool`, each with a `state`). A
 * call takes one of three routes, and the routes are exclusive:
 *
 *   1. A call that IS a LangWatch capability is a card for its whole life —
 *      {@link LangyCapabilityPendingCard} while it runs, the bespoke settled
 *      card once its output lands. Note "IS", not "is named": a bare `bash`
 *      running `langwatch trace search` counts, because `partToolName`
 *      normalises it first. Before that normalisation existed, no CLI call ever
 *      reached a capability card at all — they all fell through to (2).
 *   2. Anything else collapses into an ACTIVITY CARD, labelled by what it is
 *      DOING (`describeToolCall`, read off the call's input) rather than by the
 *      tool it happens to be. That is the difference between "Searching traces"
 *      and "Coding", and between "Using the GitHub skill" and "Skill".
 *   3. A call whose output is a staged proposal belongs to ProposalCard, and
 *      GitHub git/gh milestones ride LangyGitHubProgressCard — both are
 *      surfaced elsewhere and skipped here.
 *
 * The raw JSON is DEVELOPER MODE ONLY (`useLangyDevMode`) — a normal user never
 * sees a `{}` affordance, whatever the tool.
 *
 * Kept in its own component (not inside MessageContent) so the shared turn
 * renderer stays a single insertion point.
 */
import { Box, chakra, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import {
  cliToolResultPayload,
  cliToolResultSchema,
  parseCliJson,
  readCliErrorDocument,
} from "@langwatch/langy-contract";
import type { UIMessage } from "ai";
import { Braces, Check, ChevronRight, Layers3 } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import {
  type CapabilityCommand,
  commandOfToolCall,
  isPlanToolPart,
  isQuestionToolPart,
  LangyInterruptedNote,
  langyThinkingShimmerStyles,
  questionToolCardParts,
  useLangyDevMode,
  useLangyStore,
} from "@langwatch/langy-web";
import {
  type LangyToolErrorPresentation,
  presentLangyToolError,
} from "../logic/langyToolFailure";
import { commandOf, describeToolCall, effectiveToolName } from "../logic/langyToolLabel";
import {
  type CapabilityProgress,
  isProposalOutput,
  resolveCapability,
  resolveCapabilityProgress,
} from "./capabilities/capabilityRegistry";
import { LangyCapabilityPendingCard } from "./capabilities/LangyCapabilityPendingCard";
import {
  type CapabilityToolCall,
  hasCapabilityCard,
  LangyCapabilityRenderer,
  toolResultForCapability,
} from "./capabilities/LangyCapabilityRenderer";
import { LangyPlanLimitCard } from "./LangyPlanLimitCard";
import { LangyToolErrorCard } from "./LangyToolErrorCard";

const dotPulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.72); }
`;

/**
 * The old label table lived here. It is gone.
 *
 * It mapped a tool's NAME to a word — `bash` → "Coding", and anything unmapped
 * to a humanised version of its own name, which is how opencode's `skill` tool
 * produced a card reading "SKILL / Skill". Both were the same mistake: naming
 * the mechanism where the act belongs. A `bash` running `langwatch trace search`
 * is not "Coding"; it is searching traces, and the command said so all along.
 *
 * Every label now comes from `describeToolCall` (logic/langyToolLabel.ts), which
 * reads the tool's INPUT — the command, the skill, the path. One mapping, no
 * per-tool branches in this file.
 */

type ToolPartLike = {
  type?: string;
  state?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /** The recorded result digest, on durable parts of CLI calls (additive). */
  digest?: unknown;
  result?: unknown;
};

/**
 * The minimal view every reader here needs — just the ordered parts. Loosened
 * from `UIMessage` so a SUBSET of parts (one plan step's attributed calls) can be
 * rendered through the same functions as a whole message (LangyPlanCard).
 */
export type PartsView = { parts: readonly unknown[] };

// AI-SDK tool states that mean the call has settled (success, error, denied).
const DONE_STATES = new Set(["output-available", "output-error", "output-denied"]);

// A settled call that FAILED. It has no result to draw, so it stays on the
// honest raw-JSON path rather than pretending to be a card.
const FAILED_STATES = new Set(["output-error", "output-denied"]);

/**
 * The concrete thing a call is acting on, pulled off its input.
 *
 * (The old `detailForInput` lived here. It is gone: reading the input is now
 * `describeToolCall`'s job, alongside deciding what the call is CALLED, because
 * the two answers come from the same field and drifted apart when they didn't.)
 */

/** A single tool call, kept for the raw / developer-mode JSON view. */
export type ToolCall = {
  toolCallId?: string;
  name: string;
  state: string;
  input: unknown;
  output: unknown;
  errorText?: string;
};

export type ActivityGroup = {
  key: string;
  /** What the group is doing, in human words. Never a tool's name. */
  label: string;
  /** The concrete thing — the command, the file, the skill's purpose. */
  detail?: string;
  done: boolean;
  calls: ToolCall[];
  /** @see Sequenced */
  order: number;
  /**
   * The part index of the group's LATEST call. `order` anchors the group where
   * its first call ran; this says how recently it was active — which is what
   * decides whether it is the turn's freshest settled work (see the held card
   * in {@link LangyActivityParts}).
   */
  lastOrder: number;
};

export type FailedToolCall = {
  id: string;
  call: ToolCall;
  presentation: LangyToolErrorPresentation;
  /** @see Sequenced */
  order: number;
};

/**
 * WHERE in the turn a rendered block belongs — the index of the earliest tool
 * part that feeds it.
 *
 * Every reader below walks the parts in order, so each block already knows the
 * first part it came from; what was missing was anything that USED that. The
 * render grouped by kind instead — every failure, then every running group, then
 * the completed receipt, then the capability cards — so a failure on the last
 * call of a turn drew ABOVE the summary of the three calls that preceded it, and
 * the transcript said the turn broke before it said anything ran. A turn is a
 * sequence of events; the panel has to read like one.
 */
export type Sequenced = { order: number };

/** The raw tool name: `dynamic-tool` carries it, `tool-<name>` encodes it. */
function rawToolName(part: ToolPartLike): string | undefined {
  const type = part.type;
  if (!type) return undefined;
  if (type === "dynamic-tool") return part.toolName;
  if (type.startsWith("tool-")) return type.slice("tool-".length);
  return undefined;
}

/**
 * The name a part should be TREATED as — the single entry point for every
 * reader below.
 *
 * The server's CLI envelope types `bash("langwatch trace search")` as
 * `langwatch.trace.search`, but only on the durable event; the tool part the
 * BROWSER receives is still a bare `bash`. So the capability registry never saw
 * a capability, no capability card ever rendered for a CLI call, and the frame
 * fell through to a generic activity card labelled "Coding".
 *
 * Normalising here fixes all of it at once: a shell call carrying a LangWatch
 * command becomes the command it is, and every mapping downstream — settled
 * card, pending card, activity label — lights up on its own.
 */
function partToolName(part: ToolPartLike): string | undefined {
  const raw = rawToolName(part);
  if (!raw) return undefined;
  return effectiveToolName(raw, part.input);
}

/** Shape a part into the minimal call the capability layer reasons about. */
function partToCall(part: ToolPartLike, name: string): CapabilityToolCall {
  return {
    name,
    state: part.state ?? "unknown",
    input: part.input,
    output: part.output,
    ...(part.digest !== undefined ? { digest: part.digest } : {}),
    ...(part.result !== undefined ? { result: part.result } : {}),
  };
}

/**
 * A line that ANNOUNCES a failure — anchored to the start of one on purpose.
 *
 * The markers used to be matched anywhere in the payload, which made the phrase
 * enough: a SUCCESSFUL `bash` whose stdout merely mentioned it — `grep -rn
 * "failed to" src/`, a tailed log, a test-runner summary — drew a red error
 * card AND was dropped from the activity groups, so a step that worked was
 * reported broken and never appeared in the completed receipt. The CLI prints
 * its own failures at the head of a line; a line that only QUOTES one does not.
 *
 * Anchoring narrowed that; it did not close it, because a tailed log prints its
 * own lines at the head of a line too. So this only ever runs against the CLI's
 * own console — see {@link cliConsoleTextOf}.
 */
const CLI_FAILURE_LINE =
  /^[\s>]*(?:✖|failed to\b|request failed\b|self_signed_cert_in_chain\b)/im;

/** The raw text an output carries, bare or in the `{ text }` envelope. */
function outputText(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object" || !("text" in output)) {
    return undefined;
  }
  const text = (output as { text?: unknown }).text;
  return typeof text === "string" ? text : undefined;
}

/**
 * The CONSOLE of a call that came through the CLI ENVELOPE — the
 * `{ kind: "text", text }` result. `null` for anything else, and that is the
 * whole point of the function.
 *
 * Takes the ALREADY-PARSED document rather than the part: the envelope travels
 * as a JSON string, and the caller has to parse that string anyway to look for
 * a handled-failure document. Re-parsing it here meant a second full
 * balanced-brace scan of every multi-KB CLI result, per failing part, on every
 * uncached read.
 *
 * Unwrapping is what makes line anchoring mean anything: inside that JSON
 * string every newline is an escaped `\n`, so the whole console reads as one
 * line and no marker is ever at the start of it.
 *
 * Returning `null` rather than the raw string is what keeps prose sniffing off
 * an ordinary shell call. `bash("tail -n 20 /var/log/app.log")` exits 0, its
 * stdout is not JSON, and the server's envelope passes a non-LangWatch command
 * through untouched (`langy-cli-envelope.service.ts` — it only wraps output as
 * `{kind:"text"}` for a parsed `langwatch …` invocation). So the only thing
 * behind that call is a wall of somebody else's log lines, and "failed to
 * connect to redis, retrying" in it is a fact ABOUT the log, never a report
 * about the command. Reading it drew a red error card for a step that worked
 * and dropped that step from the completed receipt.
 */
function cliConsoleTextOf(document: unknown): string | null {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return null;
  }
  const envelope = document as { kind?: unknown; text?: unknown };
  return envelope.kind === "text" && typeof envelope.text === "string"
    ? envelope.text
    : null;
}

/**
 * Some CLI adapters finish a call with `output-available` even when the command
 * itself reported a handled failure. Treat the rendered CLI failure as the
 * source of truth: it must never receive the green capability receipt.
 *
 * Structure first, prose second, and prose ONLY inside the CLI envelope.
 * `ok: false` is the CLI contract's own discriminant (see
 * `readCliErrorDocument`), so a handled failure document settles the question
 * whatever the console noise around it says. When there is no such document we
 * read the console a line at a time — but only for a call whose console the CLI
 * actually wrote (see {@link cliConsoleTextOf}); a bare shell call's stdout
 * belongs to whatever it ran, and gets no vote on whether it succeeded.
 */
function renderedToolFailure(part: ToolPartLike): boolean {
  if (FAILED_STATES.has(part.state ?? "")) return true;

  const raw = part.output;
  const text = outputText(raw);
  const document = text !== undefined ? parseCliJson(text) : raw;
  if (readCliErrorDocument(document)) return true;

  // ONE parse, read twice. An output that IS the JSON string has already been
  // parsed into `document`, and that parse is the envelope the console read
  // wants; an output that is already an object IS the envelope, and `document`
  // is the parse of the text it carries — which is where a nested handled
  // failure hides, and not the envelope at all.
  const envelope = typeof raw === "string" ? document : raw;
  const consoleText = cliConsoleTextOf(envelope);
  if (consoleText === null) return false;
  return CLI_FAILURE_LINE.test(consoleText);
}

/**
 * Memoise a parts reader on the array it read.
 *
 * The four readers below are most of the cost of drawing a turn, and every one
 * of them walks the SAME parts at least twice per render: MessageContent asks
 * `hasLangyActivity` whether there is anything to draw, then LangyActivityParts
 * asks each reader again to draw it. Per walk, `hasCapabilityCard` JSON-parses
 * and schema-validates each CLI document, so a turn carrying a dozen multi-KB
 * results paid for dozens of parse-and-validate cycles per render — at streaming
 * rates, dozens per token.
 *
 * Keyed by IDENTITY, which is exactly right here: @ai-sdk/react snapshots the
 * message (`structuredClone`) on every update, so a parts array never changes
 * after we have seen it — a new token is a new array, and a new array is a fresh
 * read. A WeakMap so a conversation's arrays are collected with the messages
 * that own them.
 *
 * INVARIANT: no parts array may be mutated in place. Every producer builds a new
 * one — the engine's history hydration, the time-travel view, and LangyPlanCard's
 * per-step subsets alike.
 *
 * That invariant is only PARTLY enforceable, and it is worth being honest about
 * which part. `PartsView.parts` is `readonly unknown[]`, so nothing reached
 * through this seam — these readers, the components they feed — can push into an
 * array it has already answered for. What the type cannot reach is a producer
 * still holding the array as a mutable `unknown[]` before it hands it over; if
 * one ever pushed there, the WeakMap would keep serving the pre-push answer for
 * as long as the array lives. The risk is accepted rather than designed away
 * because the producer set is small, closed and listed above, and because the
 * one that generates the churn — @ai-sdk/react — cannot mutate by construction:
 * it `structuredClone`s the message on every update, so each token arrives as a
 * fresh array. A cache keyed on a deep hash instead would re-walk and re-parse
 * every CLI document per render, which is the exact cost this exists to remove.
 */
function memoizeOnParts<T>(read: (message: PartsView) => T): (message: PartsView) => T {
  const cache = new WeakMap<readonly unknown[], T>();
  return (message) => {
    const cached = cache.get(message.parts);
    if (cached !== undefined || cache.has(message.parts)) return cached as T;
    const value = read(message);
    cache.set(message.parts, value);
    return value;
  };
}

/**
 * The settled tool calls in a message that render as bespoke domain-capability
 * cards (task #12), in first-seen order. The complement of the activity groups:
 * a call is EITHER a capability card OR an activity line, never both.
 */
export const toCapabilityCalls = memoizeOnParts(readCapabilityCalls);

function readCapabilityCalls(
  message: PartsView,
): Array<{ id: string; call: CapabilityToolCall } & Sequenced> {
  const result: Array<{ id: string; call: CapabilityToolCall } & Sequenced> = [];
  message.parts.forEach((rawPart, index) => {
    const part = rawPart as ToolPartLike;
    const name = partToolName(part);
    if (!name) return;
    const call = partToCall(part, name);
    if (!hasCapabilityCard(call)) return;
    result.push({
      id: part.toolCallId ?? `${name}:${result.length}`,
      call,
      order: index,
    });
  });
  return selectTraceCards(result);
}

/** The rows a trace search surfaced — 0 for the empty "nothing matched". */
function traceRowCount(output: unknown): number {
  // `output` belongs to a call selected by `hasCapabilityCard`, so legacy
  // documents have already crossed the one compatibility adapter there.
  const result = toolResultForCapability({
    name: "langwatch.trace.search",
    state: "output-available",
    input: {},
    output,
  });
  return result?.kind === "card" && result.card === "traces"
    ? result.payload.traces.length
    : 0;
}

/**
 * A trace-sample card is a fact about the TURN — the traces it surfaced — not
 * about one tool call. But the Analytics skill probes with several
 * `trace search` calls, most of which legitimately match nothing, and one that
 * actually answers. Rendered per-call, each empty probe drew its own full
 * "No traces matched" card, stacked beside (and burying) the search that found
 * the traces the turn reported.
 *
 * So the trace cards collapse to the searches that carry traces: every search
 * that surfaced rows keeps its card; the empty probes are dropped when any
 * search answered, and deduped to a single card when none did — a genuine
 * "nothing matched" still earns one clear answer, never a wall of four. Only
 * trace searches multiply this way, so every other capability card is untouched.
 */
function selectTraceCards<T extends { id: string; call: CapabilityToolCall }>(
  entries: T[],
): T[] {
  const isTrace = (call: CapabilityToolCall) =>
    resolveCapability(call.name)?.render === "traces";

  const traceEntries = entries.filter((e) => isTrace(e.call));
  if (traceEntries.length <= 1) return entries;

  const answered = new Set(
    traceEntries
      .filter((e) => traceRowCount(e.call.result ?? e.call.output) > 0)
      .map((e) => e.id),
  );
  const anyAnswered = answered.size > 0;

  let keptEmpty = false;
  return entries.filter((e) => {
    if (!isTrace(e.call)) return true;
    if (answered.has(e.id)) return true;
    // An empty probe beside a search that answered is noise; a stack of empty
    // probes with no answer collapses to the first, so "nothing matched" is
    // said once.
    if (anyAnswered || keptEmpty) return false;
    keptEmpty = true;
    return true;
  });
}

/** A capability call still in flight — rendered as an in-progress card. */
export type PendingCapability = {
  id: string;
  progress: CapabilityProgress;
  detail?: string;
  /**
   * The parsed command, when the call is a CLI invocation — what lets the
   * pending card start hydrating rows from the query BEFORE the result
   * exists (the progressive start-frame path).
   */
  command: CapabilityCommand | null;
  /** @see Sequenced */
  order: number;
};

/**
 * The capability calls that are still RUNNING, in first-seen order.
 *
 * The complement of {@link toCapabilityCalls}: a capability is a card for its
 * whole life — pending shell while it runs, settled card once output lands —
 * so it is never demoted to a generic activity line on the way.
 */
export const toPendingCapabilities = memoizeOnParts(readPendingCapabilities);

function readPendingCapabilities(message: PartsView): PendingCapability[] {
  const pending: PendingCapability[] = [];
  message.parts.forEach((rawPart, index) => {
    const part = rawPart as ToolPartLike;
    const name = partToolName(part);
    if (!name) return;
    if (DONE_STATES.has(part.state ?? "")) return;
    const progress = resolveCapabilityProgress(name);
    if (!progress) return;
    pending.push({
      id: part.toolCallId ?? `${name}:${pending.length}`,
      progress,
      detail: describeToolCall({ name, input: part.input }).detail,
      command: commandOfToolCall({ name, input: part.input }),
      order: index,
    });
  });
  return pending;
}

/**
 * True when a message has anything for LangyToolActivity to render — an
 * activity card, an in-flight capability, or a settled capability card.
 * MessageContent uses this in its "is there anything to show?" guard so a turn
 * whose only output is a card (no prose, no proposal) still renders.
 */
export function hasLangyActivity(message: PartsView): boolean {
  return (
    toCapabilityCalls(message).length > 0 ||
    toPendingCapabilities(message).length > 0 ||
    toFailedToolCalls(message).length > 0 ||
    toActivityGroups(message).length > 0
  );
}

/** Failed calls are errors, never green "completed" activity rows. */
export const toFailedToolCalls = memoizeOnParts(readFailedToolCalls);

function readFailedToolCalls(message: PartsView): FailedToolCall[] {
  const failures: FailedToolCall[] = [];
  message.parts.forEach((rawPart, index) => {
    const part = rawPart as ToolPartLike;
    if (!renderedToolFailure(part)) return;
    const name = partToolName(part);
    if (!name) return;
    const described = describeToolCall({ name, input: part.input });
    const call: ToolCall = {
      toolCallId: part.toolCallId,
      name,
      state: part.state ?? "unknown",
      input: part.input,
      output: part.output,
      errorText: part.errorText,
    };
    failures.push({
      id: part.toolCallId ?? `${name}:${failures.length}`,
      call,
      presentation: presentLangyToolError({
        title: described.title,
        errorText: part.errorText ?? part.output,
      }),
      order: index,
    });
  });
  return failures;
}

/**
 * Collapse a message's tool parts into ordered activity groups. First-seen
 * order is preserved; a group is `done` only once every tool call in it has
 * settled, so a group with any in-flight call still reads as pending.
 */
export const toActivityGroups = memoizeOnParts(readActivityGroups);

function readActivityGroups(message: PartsView): ActivityGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, ActivityGroup>();

  message.parts.forEach((rawPart, index) => {
    const part = rawPart as ToolPartLike;
    // The plan tool (`todowrite`/`todoread`) is NEVER an activity card — it is
    // the checklist itself (LangyPlanCard), so it must not also collapse into a
    // shimmering "Planning…" row.
    if (isPlanToolPart(part)) return;
    // The `question` tool is the interactive choices card (ADR-060 §6, rendered
    // by MessageContent), never a raw activity card. It waits on the USER, so as
    // an activity it read as a dead "Question…" stuck in-flight forever. Only a
    // payload the choices contract can actually render is excluded — a broken
    // one stays here, where raw honesty belongs.
    if (isQuestionToolPart(part) && questionToolCardParts(part).length > 0) {
      return;
    }
    const name = partToolName(part);
    if (!name) return;

    // A tool call whose output is a staged proposal renders as a ProposalCard.
    if (isProposalOutput(part.output)) return;
    // A failed call has its own red error card, including structured trace/log
    // actions. It must never get the green checkmark of a completed activity.
    if (renderedToolFailure(part)) return;
    // A call whose name maps to a capability is a CARD for its whole life —
    // the pending shell while it runs, the bespoke card once it settles. Only a
    // failed one falls back here (there is no result to draw, so raw JSON is
    // the honest answer).
    const isKnownCapability = resolveCapability(name) !== null;
    if (
      (isKnownCapability && !DONE_STATES.has(part.state ?? "")) ||
      hasCapabilityCard(partToCall(part, name))
    ) {
      return;
    }

    // What this call is DOING — read from its input, not its type. `bash`
    // running `langwatch trace search` says "Searching traces"; the `skill` tool
    // says which skill and what it is for. Never "Coding", never "Skill".
    const described = describeToolCall({ name, input: part.input });
    const key = described.key;
    const done = DONE_STATES.has(part.state ?? "");
    const call: ToolCall = {
      toolCallId: part.toolCallId,
      name,
      state: part.state ?? "unknown",
      input: part.input,
      output: part.output,
      errorText: part.errorText,
    };

    const existing = byKey.get(key);
    if (existing) {
      // Any still-running call in the group keeps the whole group pending. The
      // LATEST call's detail wins — a group of file edits should name the file
      // being edited now, not the first one it touched.
      existing.done = existing.done && done;
      existing.detail = described.detail ?? existing.detail;
      existing.calls.push(call);
      existing.lastOrder = index;
    } else {
      order.push(key);
      byKey.set(key, {
        key,
        label: described.title,
        detail: described.detail,
        done,
        calls: [call],
        order: index,
        lastOrder: index,
      });
    }
  });

  return order.map((key) => byKey.get(key)!);
}

export function LangyToolActivity({
  message,
  reasoningTitles,
  live = true,
}: {
  message: UIMessage;
  /**
   * The turn's folded reasoning-summary headlines (logic/langyReasoningTitles):
   * the model's thinking steps between tool calls. They ride the completed
   * receipt — never the transcript — so a settled turn's process record is one
   * collapsed card, not a stack of loose bold lines above the answer.
   */
  reasoningTitles?: string[];
  /** @see LangyActivityParts */
  live?: boolean;
}) {
  return (
    <LangyActivityParts
      parts={message.parts}
      reasoningTitles={reasoningTitles}
      live={live}
    />
  );
}

/**
 * Render a set of tool parts as activity — the reusable spine shared by a whole
 * message (LangyToolActivity) and one plan step's attributed calls
 * (LangyPlanCard). Renders nothing when the parts carry no activity, so a bucket
 * with only prose collapses to nothing.
 *
 * `live` says whether the turn these parts belong to is still running. It is
 * what tells an unfinished call apart from an INTERRUPTED one: a tool part is
 * only ever closed by its own output, so a turn that the user stopped (or that
 * died) leaves its open calls in the running state for good. On a settled turn
 * those calls are drawn as interrupted, with no pulse and no shimmer, instead
 * of a card that says "Searching traces…" for the rest of the conversation.
 */
export function LangyActivityParts({
  parts,
  reasoningTitles = [],
  live = true,
}: PartsView & { reasoningTitles?: string[]; live?: boolean }) {
  const [devMode] = useLangyDevMode();
  const turnProgress = useLangyStore((state) => state.turnProgress);
  const turnProgressSample = useLangyStore((state) => state.turnProgressSample);
  const turnPhase = useLangyStore((state) => state.turnPhase);
  const view: PartsView = { parts };
  const groups = toActivityGroups(view);
  const runningGroups = groups.filter((group) => !group.done);
  const allCompletedGroups = groups.filter((group) => group.done);
  const capabilityCalls = toCapabilityCalls(view);
  const capabilityBatches = batchCapabilityCalls(capabilityCalls);
  const pending = toPendingCapabilities(view);
  const failures = toFailedToolCalls(view);
  if (
    groups.length === 0 &&
    capabilityCalls.length === 0 &&
    pending.length === 0 &&
    failures.length === 0
  ) {
    return null;
  }

  // While the turn is streaming, the action that finished LAST holds its
  // ground as a settled card instead of folding into the receipt the instant
  // its output lands — the reader is watching the model think about what that
  // call returned. It folds when anything takes its place: the next call
  // starting (running or pending below), answer text streaming in after it, a
  // failure or capability card landing after it, or the turn settling.
  const heldGroup = (() => {
    if (turnPhase === "idle") return null;
    if (runningGroups.length > 0 || pending.length > 0) return null;
    if (allCompletedGroups.length === 0) return null;
    const latest = allCompletedGroups.reduce((left, right) =>
      right.lastOrder > left.lastOrder ? right : left,
    );
    const supersededAt = Math.max(
      lastAnswerTextIndex(view),
      ...capabilityCalls.map((entry) => entry.order),
      ...failures.map((failure) => failure.order),
    );
    return latest.lastOrder > supersededAt ? latest : null;
  })();
  const completedGroups = heldGroup
    ? allCompletedGroups.filter((group) => group !== heldGroup)
    : allCompletedGroups;

  // One ordered transcript, not four stacked piles keyed by kind. Every block
  // knows the part it came from, so the render is a stable sort on that: a
  // failure lands exactly where it happened, and the receipt for the steps
  // before it stays before it. See {@link Sequenced}.
  const rows: Array<{ key: string; order: number; node: ReactNode }> = [
    ...failures.map(({ id, call, presentation, order }) => ({
      key: `failure:${id}`,
      order,
      node: (
        <FailedToolCallRow call={call} presentation={presentation} devMode={devMode} />
      ),
    })),
    ...runningGroups.map((group) => ({
      key: `running:${group.key}`,
      order: group.order,
      node: (
        <VStack align="stretch" gap={2} role="list">
          <RunningActivityCard group={group} devMode={devMode} interrupted={!live} />
        </VStack>
      ),
    })),
    // Finished work has ONE shape, whatever the count. It used to render as a
    // bare activity card while there was exactly one of it and as the receipt
    // from two onward — so the moment a second action finished, the block the
    // reader was looking at was torn down and replaced by a differently-shaped
    // one. Within a single turn that read as the answer flickering between
    // three unrelated card designs. The key is fixed for the same reason: it
    // is the same receipt gaining a line, not a new element each time.
    ...(completedGroups.length > 0
      ? [
          {
            key: "completed-batch",
            // The receipt stands where the first step it summarises ran.
            order: Math.min(...completedGroups.map((group) => group.order)),
            node: (
              <CompletedActivityBatch
                groups={completedGroups}
                reasoningTitles={reasoningTitles}
                devMode={devMode}
              />
            ),
          },
        ]
      : []),
    ...(heldGroup
      ? [
          {
            key: `held:${heldGroup.key}`,
            order: heldGroup.lastOrder,
            node: (
              <VStack align="stretch" gap={2} role="list">
                <LatestSettledActivityCard group={heldGroup} devMode={devMode} />
              </VStack>
            ),
          },
        ]
      : []),
    ...capabilityBatches.map((batch) => ({
      key: `capability:${batch.key}`,
      order: batch.order,
      node: <CapabilityBatchRow batch={batch} devMode={devMode} />,
    })),
    ...pending.map(({ id, progress, detail, command, order }, index) => ({
      key: `pending:${id}`,
      order,
      node: (
        <LangyCapabilityPendingCard
          surface={progress.surface}
          overline={progress.overline}
          headline={progress.headline}
          detail={detail}
          command={command}
          progress={index === pending.length - 1 ? turnProgress : null}
          progressSample={index === pending.length - 1 ? turnProgressSample : null}
          interrupted={!live}
        />
      ),
    })),
  ].sort((left, right) => left.order - right.order);

  return (
    // `role="log"` is what makes this column readable to assistive tech. A
    // VStack is a plain div, whose implicit role is `generic` — and `aria-label`
    // is prohibited there, so without a role the name is dropped and the column
    // is an anonymous stack: a reader who lands on the running indicator or on
    // the red failure card gets the line but nothing saying what region it came
    // from, and appended entries go unannounced. `log` (polite by default) is
    // the right role for a running record whose entries are appended at the
    // end, which is exactly what a turn's activity is.
    //
    // The settled rows below — CompletedActivityBatch, CapabilityBatchRow,
    // FailedToolCallRow — deliberately carry no live-region attributes: `log`
    // already announces an appended entry politely, and a nested `role="status"`
    // on a row that only ever arrives by being appended would make some screen
    // readers say it twice. So the rule for anything nested in here is: add a
    // live region only when it earns one independently — because it updates IN
    // PLACE rather than being appended (LangyCapabilityPendingCard's running
    // headline, which is also rendered outside this column), or because it is
    // assertive and announces wherever it sits (LangyToolErrorCard's
    // `role="alert"`). The status lines beside this column
    // (StreamingStatusLine, LangyThinkingLine, LangyRecoveringLine) sit OUTSIDE
    // it, which is why each of those owns its own `role="status"`.
    <VStack align="stretch" gap={2} role="log" aria-label="Langy activity">
      {rows.map((row) => (
        <Fragment key={row.key}>{row.node}</Fragment>
      ))}
    </VStack>
  );
}

/**
 * The implementation trail is one receipt, not one card per mechanism. Hover
 * previews it; click pins it open for touch/keyboard users.
 */
function CompletedActivityBatch({
  groups,
  reasoningTitles = [],
  devMode,
}: {
  groups: ActivityGroup[];
  /** The turn's folded thinking steps — rows of the receipt, expanded only. */
  reasoningTitles?: string[];
  devMode: boolean;
}) {
  // The receipt is an index, not a hover-only disclosure. Keep every action
  // visible by default so a seven-step dataset/evaluation flow cannot look like
  // it silently skipped three calls on touchscreens or keyboard navigation.
  const [open, setOpen] = useState(true);
  const userToggled = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!userToggled.current) setOpen(false);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, []);
  const callCount = groups.reduce((count, group) => count + group.calls.length, 0);

  return (
    // The summary is the CARD; the steps it summarises hang beneath it. A
    // border wrapping both was tried and reverted — the receipt reads better
    // as a compact row you can expand than as a box that grows a list inside
    // itself.
    <VStack align="stretch" gap={2}>
      <chakra.button
        type="button"
        width="full"
        paddingX={3}
        paddingY={2.5}
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="langyCard"
        background="bg.subtle"
        textAlign="left"
        cursor="pointer"
        aria-expanded={open}
        onClick={() => {
          userToggled.current = true;
          setOpen((value) => !value);
        }}
        _hover={{ borderColor: "border.emphasized" }}
      >
        <HStack gap={2}>
          <Box color="green.fg" display="flex" flexShrink={0}>
            <Check size={11} />
          </Box>
          <Text textStyle="xs" fontWeight="560" color="fg" flex={1} truncate>
            {groups.length} {groups.length === 1 ? "action" : "actions"} completed
          </Text>
          <Text textStyle="2xs" color="fg.subtle">
            {callCount} {callCount === 1 ? "tool call" : "tool calls"}
          </Text>
          <Box
            color="fg.subtle"
            display="flex"
            transform={open ? "rotate(90deg)" : undefined}
            transition="transform 150ms ease"
          >
            <ChevronRight size={12} />
          </Box>
        </HStack>
      </chakra.button>
      {open ? (
        <VStack
          align="stretch"
          gap={0}
          paddingRight={3}
          paddingLeft={3}
          paddingY={1}
          marginLeft={3}
          borderLeftWidth="1px"
          borderColor="border.muted"
          role="list"
        >
          {groups.map((group) => (
            <CompletedActivityRow key={group.key} group={group} devMode={devMode} />
          ))}
          {/* The thinking steps the model narrated between calls — part of the
              turn's process record, so they live in the same receipt as the
              actions they punctuated, quieter (they claim thought, not work). */}
          {reasoningTitles.map((title, index) => (
            <Text
              key={`thought-${index}`}
              role="listitem"
              textStyle="xs"
              color="fg.subtle"
              fontStyle="italic"
              paddingY={1.5}
              truncate
              title={title}
            >
              {title}
            </Text>
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

/**
 * One finished step inside the receipt.
 *
 * It carries dev mode's raw-payload toggle, which used to live on the
 * standalone card that a lone completed group rendered as. Routing every count
 * through the receipt — so finished work has one shape instead of changing
 * design the moment a second action lands — would otherwise have quietly taken
 * away the only way to read a call's JSON.
 */
function CompletedActivityRow({
  group,
  devMode,
}: {
  group: ActivityGroup;
  devMode: boolean;
}) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  // The receipt names what ran; the result is what the model actually read,
  // and "why did it conclude that?" is unanswerable without it. Only rows
  // with a recorded result open — an empty disclosure would promise
  // something the record does not hold.
  const callsWithResult = group.calls.filter((call) => toolResultText(call) !== null);
  const canOpenResult = callsWithResult.length > 0;

  // Spans, not the default paragraph: the disclosure below wraps these in a
  // native <button>, which may hold phrasing content only.
  const label = (
    <Text
      as="span"
      display="block"
      textStyle="xs"
      color="fg"
      fontWeight="520"
      flex={1}
      // Without this the label wraps to a second line and the row grows,
      // while the detail beside it truncates — the two halves of one row
      // disagreeing about how to run out of space.
      minWidth={0}
      truncate
    >
      {completedActivityLabel(group.label)}
    </Text>
  );
  const detail = group.detail ? (
    <Text
      as="span"
      display="block"
      textStyle="2xs"
      color="fg.subtle"
      fontFamily="mono"
      maxWidth="52%"
      truncate
    >
      {group.detail}
    </Text>
  ) : null;

  return (
    <VStack align="stretch" gap={1} role="listitem">
      <HStack gap={2} paddingY={1.5}>
        {canOpenResult ? (
          <ResultDisclosureButton
            isExpanded={resultOpen}
            onToggle={() => setResultOpen((value) => !value)}
          >
            {label}
            {/* The truncated command gives way to the full one below it. */}
            {resultOpen ? null : detail}
          </ResultDisclosureButton>
        ) : (
          <>
            {label}
            {detail}
          </>
        )}
        {devMode ? (
          <RawDataToggle
            isOpen={jsonOpen}
            onToggle={() => setJsonOpen((value) => !value)}
          />
        ) : null}
      </HStack>
      {resultOpen ? (
        <VStack align="stretch" gap={1.5} paddingBottom={1.5}>
          {callsWithResult.map((call, index) => (
            <OpenedToolCall key={call.toolCallId ?? index} call={call} />
          ))}
        </VStack>
      ) : null}
      {devMode && jsonOpen ? (
        <VStack align="stretch" gap={1} paddingBottom={1.5}>
          {group.calls.map((call, index) => (
            <RawCallJson key={call.toolCallId ?? index} call={call} />
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

/**
 * The label half of a finished row, made to open. The devMode raw-JSON toggle
 * sits beside it as its own button, so the disclosure covers only this half —
 * a button inside a button is not a thing.
 */
function ResultDisclosureButton({
  isExpanded,
  onToggle,
  children,
}: {
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <chakra.button
      type="button"
      display="flex"
      alignItems="center"
      gap={2}
      flex={1}
      minWidth={0}
      textAlign="left"
      cursor="pointer"
      aria-expanded={isExpanded}
      onClick={onToggle}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "orange.solid",
        outlineOffset: "2px",
        borderRadius: "4px",
      }}
    >
      {children}
      <Box
        as="span"
        color="fg.subtle"
        transition="transform 0.18s ease"
        transform={isExpanded ? "rotate(90deg)" : undefined}
        flexShrink={0}
        display="flex"
      >
        <ChevronRight size={12} />
      </Box>
    </chakra.button>
  );
}

/** Dev mode's raw-payload toggle for one finished row. */
function RawDataToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  const label = isOpen ? "Hide raw data" : "Show raw data";
  return (
    <Tooltip content={label} showArrow>
      <IconButton
        size="2xs"
        variant="ghost"
        color={isOpen ? "orange.solid" : "fg.subtle"}
        aria-label={label}
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <Braces size={12} />
      </IconButton>
    </Tooltip>
  );
}

/**
 * What one finished call returned, as the model read it. A failed call's
 * result IS its error text. Null when the record kept no result at all —
 * the caller uses that to withhold the disclosure, not to render "nothing".
 *
 * The DATA, not the transport. A CLI result travels as a JSON string holding
 * the `{ kind, payload }` envelope (see `cliToolResultSchema`), so printing
 * `call.output` verbatim showed the reader `{"kind":"json","payload":[]}` on
 * one unindented line: the envelope quoted at them, with the answer they came
 * for as a fragment inside it. Unwrap to the payload and indent it.
 *
 * Only an output that is JSON *whole* is reformatted, which is why this parses
 * strictly instead of reaching for `parseCliJson`. That reader lifts the first
 * balanced document out of surrounding console noise, which is right for a card
 * (it wants the document) and wrong here (the noise is part of what the model
 * read). A shell call that logs a line and then prints JSON keeps both.
 */
function toolResultText(call: ToolCall): string | null {
  if (call.errorText) return call.errorText;
  const raw = call.output;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return renderResultValue(unwrapCliEnvelope(raw));
  if (raw.trim().length === 0) return null;

  const parsed = parseWholeJson(raw);
  return parsed === undefined ? raw : renderResultValue(unwrapCliEnvelope(parsed.value));
}

/** The payload a CLI envelope carries, or the document when it is not one. */
function unwrapCliEnvelope(document: unknown): unknown {
  const envelope = cliToolResultSchema.safeParse(document);
  return envelope.success ? cliToolResultPayload(envelope.data) : document;
}

/** A result value as text: a string as it stands, anything else indented. */
function renderResultValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim().length > 0 ? value : null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** The value a string holds when the WHOLE string is JSON, else undefined. */
function parseWholeJson(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

/**
 * One finished call, opened: what ran, and then what came back.
 *
 * The command is shown again here rather than left to the row's label, because
 * a row groups calls by what they DID: two `langwatch trace search` calls that
 * differ only in their flags share the single label "Searched traces", and the
 * command is then the only thing that says which result belongs to which. That
 * is not a corner case. Asking for one day and then for everything is how the
 * agent answers a question about a time range.
 */
function OpenedToolCall({ call }: { call: ToolCall }) {
  const command = commandOf(call.input);
  return (
    <VStack align="stretch" gap={1}>
      {command ? (
        <Text textStyle="2xs" fontFamily="mono" color="fg.subtle" wordBreak="break-all">
          $ {command}
        </Text>
      ) : null}
      <ToolResultBlock call={call} />
    </VStack>
  );
}

function ToolResultBlock({ call }: { call: ToolCall }) {
  return (
    <Box
      as="pre"
      textStyle="2xs"
      fontFamily="mono"
      color="fg.muted"
      background="bg.muted"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      borderRadius="sm"
      padding={2}
      margin={0}
      maxHeight="240px"
      overflowY="auto"
      overflowX="auto"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
    >
      {toolResultText(call)}
    </Box>
  );
}

type CapabilityCallEntry = ReturnType<typeof toCapabilityCalls>[number];
type CapabilityBatch = {
  key: string;
  entries: CapabilityCallEntry[];
  label: string;
  /** @see Sequenced */
  order: number;
};

/**
 * Repeated capability calls are one piece of work, not a deck of cards. Group
 * them by semantic result (surface + tone + noun); the receipt stays compact
 * and the original cards remain one click away for inspection.
 */
function batchCapabilityCalls(entries: CapabilityCallEntry[]): CapabilityBatch[] {
  const order: string[] = [];
  const batches = new Map<string, CapabilityBatch>();
  for (const entry of entries) {
    const descriptor = resolveCapability(entry.call.name);
    const key = descriptor
      ? `${descriptor.surface}:${descriptor.tone}:${descriptor.noun.plural}`
      : entry.id;
    const existing = batches.get(key);
    if (existing) {
      existing.entries.push(entry);
      existing.label = capabilityBatchLabel(descriptor, existing.entries.length);
      continue;
    }
    order.push(key);
    batches.set(key, {
      key,
      entries: [entry],
      label: capabilityBatchLabel(descriptor, 1),
      order: entry.order,
    });
  }
  return order.map((key) => batches.get(key)!);
}

function capabilityBatchLabel(
  descriptor: ReturnType<typeof resolveCapability>,
  count: number,
): string {
  if (!descriptor) return count === 1 ? "Tool result" : `${count} tool results`;
  const noun = count === 1 ? descriptor.noun.singular : descriptor.noun.plural;
  switch (descriptor.tone) {
    case "created":
      return `Created ${count} ${noun}`;
    case "updated":
      return `Updated ${count} ${noun}`;
    case "removed":
      return `Removed ${count} ${noun}`;
    case "read":
    default:
      return count === 1 ? `Read ${noun}` : `Checked ${noun} ${count} times`;
  }
}

function CapabilityBatchRow({
  batch,
  devMode,
}: {
  batch: CapabilityBatch;
  devMode: boolean;
}) {
  const isBatched = batch.entries.length > 1;
  const [open, setOpen] = useState(true);
  const userToggled = useRef(false);
  // Only arm the auto-collapse once this row actually renders the batch UI.
  // Running it unconditionally drove `open` to false while the row was still a
  // single card, so the moment a second entry arrived the batch rendered
  // ALREADY collapsed — hiding both cards the reader was looking at behind a
  // summary header they never clicked. Keying on `isBatched` also restarts the
  // timer at the instant the batch appears, which is when the 2.2s reading
  // window is supposed to begin.
  useEffect(() => {
    if (!isBatched) return;
    const timer = window.setTimeout(() => {
      if (!userToggled.current) setOpen(false);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [isBatched]);
  if (!isBatched) {
    const entry = batch.entries[0]!;
    return <CapabilityCardRow call={entry.call} devMode={devMode} />;
  }

  return (
    <VStack align="stretch" gap={2}>
      <chakra.button
        type="button"
        width="full"
        paddingX={3}
        paddingY={2.5}
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="langyCard"
        background="bg.subtle"
        textAlign="left"
        cursor="pointer"
        aria-expanded={open}
        onClick={() => {
          userToggled.current = true;
          setOpen((value) => !value);
        }}
        _hover={{ borderColor: "border.emphasized" }}
      >
        <HStack gap={2}>
          <Box color="green.fg" display="flex" flexShrink={0}>
            <Layers3 size={12} />
          </Box>
          <Text textStyle="xs" fontWeight="560" color="fg" flex={1} truncate>
            {batch.label}
          </Text>
          <Box
            color="fg.subtle"
            display="flex"
            transform={open ? "rotate(90deg)" : undefined}
            transition="transform 150ms ease"
          >
            <ChevronRight size={12} />
          </Box>
        </HStack>
      </chakra.button>
      {open ? (
        <VStack align="stretch" gap={2} paddingLeft={2}>
          {batch.entries.map((entry) => (
            <CapabilityCardRow key={entry.id} call={entry.call} devMode={devMode} />
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

function FailedToolCallRow({
  call,
  presentation,
  devMode,
}: {
  call: ToolCall;
  presentation: LangyToolErrorPresentation;
  devMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <VStack align="stretch" gap={1}>
      <Box position="relative">
        {/* A plan limit is not a broken step, it is a decision the reader can
            change — so it gets the upgrade card, INSTEAD of the failure card,
            never beside it. */}
        {presentation.limit ? (
          <LangyPlanLimitCard presentation={presentation} />
        ) : (
          <LangyToolErrorCard presentation={presentation} />
        )}
        {devMode ? (
          <Box position="absolute" top={2} right={2}>
            <Tooltip content={open ? "Hide raw data" : "Show raw data"} showArrow>
              <IconButton
                size="2xs"
                variant="ghost"
                color={open ? "orange.solid" : "fg.subtle"}
                aria-label={open ? "Hide raw data" : "Show raw data"}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
              >
                <Braces size={12} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : null}
      </Box>
      {devMode && open ? <RawCallJson call={call} /> : null}
    </VStack>
  );
}

/**
 * One capability card, plus (in developer mode) a toggle to reveal the raw
 * tool payload behind it — the same inspect affordance the generic activity
 * rows offer, so the whole event stream stays inspectable.
 */
function CapabilityCardRow({
  call,
  devMode,
}: {
  call: CapabilityToolCall;
  devMode: boolean;
}) {
  // Closed by default. Developer mode turning ON is not a request to see
  // every payload at once — it is a request for the AFFORDANCE. Defaulting
  // open buried each card under its own JSON dump.
  const [open, setOpen] = useState(false);
  return (
    <VStack align="stretch" gap={1}>
      <Box position="relative">
        <LangyCapabilityRenderer call={call} />
        {devMode ? (
          <Box position="absolute" top={2} right={2}>
            <Tooltip content={open ? "Hide raw data" : "Show raw data"} showArrow>
              <IconButton
                size="2xs"
                variant="ghost"
                color={open ? "orange.solid" : "fg.subtle"}
                aria-label={open ? "Hide raw data" : "Show raw data"}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                <Braces size={12} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : null}
      </Box>
      {devMode && open ? (
        <RawCallJson
          call={{
            name: call.name,
            state: call.state,
            input: call.input,
            output: call.output,
          }}
        />
      ) : null}
    </VStack>
  );
}

/** The distinct tool names in a group, as the card's mono overline. */
function groupToolNames(group: ActivityGroup): string {
  const seen: string[] = [];
  for (const call of group.calls) {
    if (!seen.includes(call.name)) seen.push(call.name);
  }
  return seen.slice(0, 3).join(" · ");
}

/**
 * The card's overline: a CATEGORY, not a tool name.
 *
 * It used to print the raw tool names — which is how a card came to be headed
 * "SKILL" with a body that also just said "Skill". The category comes off the
 * group key, which `describeToolCall` already derived from the call's intent.
 */
function groupCategory(group: ActivityGroup): string {
  const [head] = group.key.split(":");
  switch (head) {
    case "skill":
      return "Skill";
    case "github":
      return "GitHub";
    case "shell":
      return "Command";
    case "files":
      return "Files";
    case "web":
      return "Web";
    case "plan":
      return "Plan";
    case "task":
      return "Task";
    default:
      // `tool:<name>` — an unmapped tool. Its own name is the honest category.
      return groupToolNames(group);
  }
}

/**
 * One RUNNING activity group, as a CARD.
 *
 * It used to be naked text — a bare word ("Coding") floating in the message
 * column with a `{}` blob of raw tool JSON hanging off it, shown to everyone.
 * Now it speaks the same card language as every capability: the tool/skill NAME
 * on the overline, the activity as the title, and the concrete thing being done
 * (the command, the path, the pattern) underneath in mono.
 *
 * IN-FLIGHT ONLY, and the type cannot say so: its one call site renders it from
 * `groups.filter((group) => !group.done)`, and the instant a group settles it
 * moves to the completed receipt under a different key, so this card unmounts.
 * It used to carry a whole second life as its own settled/collapsed card —
 * `useState(group.done)`, a 2.2s auto-collapse, a collapsed summary button —
 * none of which any mounted instance could ever reach, because `group.done` is
 * false for every group that gets here. Finished work has exactly one shape
 * ({@link CompletedActivityBatch}); that is the whole point of the receipt.
 *
 * The raw payload is DEVELOPER MODE ONLY — there is no `{}` affordance at all
 * for a normal user, whichever tool it is. An unmapped tool is not a licence to
 * dump JSON in someone's chat; its name and its input are the honest answer.
 */
/**
 * The part index of the last streamed answer text — a settled action older than
 * the answer's own words has been read past, so it has no claim to stay out of
 * the receipt. Reasoning parts deliberately do NOT count: thinking after a call
 * is exactly the window the held card exists for.
 */
function lastAnswerTextIndex(view: PartsView): number {
  let last = -1;
  view.parts.forEach((part, index) => {
    const candidate = part as { type?: string; text?: string };
    if (
      candidate?.type === "text" &&
      typeof candidate.text === "string" &&
      candidate.text.trim().length > 0
    ) {
      last = index;
    }
  });
  return last;
}

/**
 * The action that just finished, still on the table.
 *
 * Rendered for the turn's latest settled activity group while the turn is live
 * and nothing has taken its place — the reader is watching the model think
 * about what this call returned, so the card holds its ground instead of
 * folding into the receipt the instant the output lands. Same geometry as
 * {@link RunningActivityCard}: a green check for the pulse, the past-tense
 * label for the shimmer.
 */
function LatestSettledActivityCard({
  group,
  devMode,
}: {
  group: ActivityGroup;
  devMode: boolean;
}) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const detail = group.detail;
  // The same disclosure the receipt row carries: the reader is watching the
  // model think about what this call returned, so what it returned has to be
  // readable here too, not only after the card folds into the receipt.
  const callsWithResult = group.calls.filter((call) => toolResultText(call) !== null);

  return (
    <VStack
      align="stretch"
      gap={2}
      role="listitem"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      borderRadius="langyCard"
      background="bg.subtle"
      boxShadow="langyCard"
      paddingX="15px"
      paddingY="12px"
    >
      <HStack gap={1.5} align="center">
        <Box color="green.fg" display="flex" flexShrink={0}>
          <Check size={11} />
        </Box>
        <Text
          textStyle="2xs"
          fontWeight="500"
          letterSpacing="0.03em"
          textTransform="uppercase"
          color="fg.subtle"
          truncate
          flex={1}
          minWidth={0}
        >
          {groupCategory(group)}
        </Text>
        {devMode ? (
          <RawDataToggle
            isOpen={jsonOpen}
            onToggle={() => setJsonOpen((value) => !value)}
          />
        ) : null}
      </HStack>

      {callsWithResult.length > 0 ? (
        <ResultDisclosureButton
          isExpanded={resultOpen}
          onToggle={() => setResultOpen((value) => !value)}
        >
          {/* The truncated command gives way to the full one below it. */}
          <SettledActivityLabel
            label={group.label}
            detail={resultOpen ? undefined : detail}
          />
        </ResultDisclosureButton>
      ) : (
        <SettledActivityLabel label={group.label} detail={detail} />
      )}

      {resultOpen ? (
        <VStack align="stretch" gap={1.5}>
          {callsWithResult.map((call, index) => (
            <OpenedToolCall key={call.toolCallId ?? index} call={call} />
          ))}
        </VStack>
      ) : null}

      {devMode && jsonOpen ? (
        <VStack align="stretch" gap={1}>
          {group.calls.map((call, index) => (
            <RawCallJson key={call.toolCallId ?? index} call={call} />
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

/**
 * The held card's headline and its mono detail line, as one block.
 *
 * Spans throughout, because the disclosure wraps this in a native `<button>`,
 * which may hold phrasing content only.
 */
function SettledActivityLabel({ label, detail }: { label: string; detail?: string }) {
  return (
    <Box
      as="span"
      display="flex"
      flexDirection="column"
      alignItems="stretch"
      gap={2}
      flex={1}
      minWidth={0}
    >
      <Box as="span" textStyle="sm" fontWeight="640" lineHeight="1.3">
        {completedActivityLabel(label)}
      </Box>
      {detail ? (
        <Text
          as="span"
          display="block"
          textStyle="2xs"
          fontFamily="mono"
          color="fg.subtle"
          truncate
        >
          {detail}
        </Text>
      ) : null}
    </Box>
  );
}

function RunningActivityCard({
  group,
  devMode,
  interrupted = false,
}: {
  group: ActivityGroup;
  devMode: boolean;
  /**
   * The turn ended while this call was still open — the user stopped it, or it
   * died. The card keeps the work it named and drops every claim of activity:
   * no pulse, no shimmer, no trailing ellipsis, and it says what happened.
   */
  interrupted?: boolean;
}) {
  const reduce = useReducedMotion();
  // The raw payload has its OWN toggle. It used to ride a card-expansion state,
  // which meant developer mode showed the JSON on every expanded card without
  // the `{}` ever being clicked. Closed until asked, every time.
  const [jsonOpen, setJsonOpen] = useState(false);
  const detail = group.detail;
  const shimmer =
    reduce || interrupted
      ? { ...langyThinkingShimmerStyles, animation: "none" }
      : langyThinkingShimmerStyles;

  return (
    <VStack
      align="stretch"
      gap={2}
      role="listitem"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      borderRadius="langyCard"
      background="bg.subtle"
      boxShadow="langyCard"
      paddingX="15px"
      paddingY="12px"
    >
      <RunningActivityHeader
        category={groupCategory(group)}
        live={!interrupted && !reduce}
        muted={interrupted}
        devMode={devMode}
        jsonOpen={jsonOpen}
        onToggleJson={() => setJsonOpen((v) => !v)}
      />

      <Box
        textStyle="sm"
        fontWeight="640"
        lineHeight="1.3"
        color={interrupted ? "fg.muted" : undefined}
        css={interrupted ? undefined : shimmer}
      >
        {interrupted ? group.label : `${group.label}…`}
      </Box>

      {detail ? (
        <Text textStyle="2xs" fontFamily="mono" color="fg.subtle" truncate>
          {detail}
        </Text>
      ) : null}

      {interrupted ? <LangyInterruptedNote /> : null}

      {devMode && jsonOpen ? (
        <VStack align="stretch" gap={1}>
          {group.calls.map((call, index) => (
            <RawCallJson key={call.toolCallId ?? index} call={call} />
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

/** The card's top row: the state dot, what kind of work it is, the raw toggle. */
function RunningActivityHeader({
  category,
  live,
  muted,
  devMode,
  jsonOpen,
  onToggleJson,
}: {
  category: string;
  /** The dot pulses. False for reduced motion and for an interrupted card. */
  live: boolean;
  /** The work is over, so the dot drops to a quiet grey. */
  muted: boolean;
  devMode: boolean;
  jsonOpen: boolean;
  onToggleJson: () => void;
}) {
  return (
    <HStack gap={1.5} align="center">
      <Box
        width="6px"
        height="6px"
        borderRadius="full"
        background={muted ? "fg.subtle" : "orange.solid"}
        opacity={muted ? 0.6 : 1}
        flexShrink={0}
        css={live ? { animation: `${dotPulse} 1.4s ease-in-out infinite` } : undefined}
      />
      <Text
        textStyle="2xs"
        fontWeight="500"
        letterSpacing="0.03em"
        textTransform="uppercase"
        color="fg.subtle"
        truncate
        flex={1}
        minWidth={0}
      >
        {category}
      </Text>
      {devMode ? (
        <Tooltip content={jsonOpen ? "Hide raw data" : "Show raw data"} showArrow>
          <IconButton
            size="2xs"
            variant="ghost"
            color={jsonOpen ? "orange.solid" : "fg.subtle"}
            aria-label={jsonOpen ? "Hide raw data" : "Show raw data"}
            aria-expanded={jsonOpen}
            onClick={onToggleJson}
          >
            <Braces size={12} />
          </IconButton>
        </Tooltip>
      ) : null}
    </HStack>
  );
}

function completedActivityLabel(label: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/^Running\b/i, "Ran"],
    [/^Reading\b/i, "Read"],
    [/^Writing\b/i, "Wrote"],
    [/^Editing\b/i, "Edited"],
    [/^Searching\b/i, "Searched"],
    [/^Using\b/i, "Used"],
    [/^Cloning\b/i, "Cloned"],
    [/^Creating\b/i, "Created"],
    [/^Committing\b/i, "Committed"],
    [/^Pushing\b/i, "Pushed"],
    [/^Opening\b/i, "Opened"],
    [/^Applying\b/i, "Applied"],
    [/^Looking\b/i, "Looked"],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(label)) return label.replace(pattern, replacement);
  }
  return label;
}

function RawCallJson({ call }: { call: ToolCall }) {
  return (
    <Box
      as="pre"
      textStyle="2xs"
      fontFamily="mono"
      color="fg.muted"
      background="bg.muted"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      borderRadius="sm"
      padding={2}
      margin={0}
      overflowX="auto"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
    >
      {stringifyCall(call)}
    </Box>
  );
}

function stringifyCall(call: ToolCall): string {
  const payload: Record<string, unknown> = {
    tool: call.name,
    state: call.state,
  };
  if (call.input !== undefined) payload.input = call.input;
  if (call.output !== undefined) payload.output = call.output;
  if (call.errorText) payload.error = call.errorText;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return `{ "tool": ${JSON.stringify(call.name)}, "state": ${JSON.stringify(
      call.state,
    )} }`;
  }
}
