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
import {
  Box,
  chakra,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import type { UIMessage } from "ai";
import { Braces, Check, ChevronRight, Layers3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useLangyDevMode } from "../hooks/useLangyDevMode";
import { useLangyStore } from "../stores/langyStore";
import { langyThinkingShimmerStyles } from "./langyShimmer";
import { isPlanToolPart } from "../logic/langyPlan";
import { describeToolCall, effectiveToolName } from "../logic/langyToolLabel";
import {
  commandOfToolCall,
  type CapabilityCommand,
} from "../logic/langyCapabilityDigest";
import {
  type CapabilityProgress,
  isProposalOutput,
  resolveCapability,
  resolveCapabilityProgress,
} from "./capabilities/capabilityRegistry";
import { LangyCapabilityPendingCard } from "./capabilities/LangyCapabilityPendingCard";
import { collectionOf } from "./capabilities/cliResultDocument";
import {
  type CapabilityToolCall,
  hasCapabilityCard,
  LangyCapabilityRenderer,
  toolResultForCapability,
} from "./capabilities/LangyCapabilityRenderer";
import {
  LangyToolErrorCard,
  presentLangyToolError,
  type LangyToolErrorPresentation,
} from "./LangyToolErrorCard";

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
const DONE_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

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
};

export type FailedToolCall = {
  id: string;
  call: ToolCall;
  presentation: LangyToolErrorPresentation;
};

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
 * Some CLI adapters finish a shell call with `output-available` even when the
 * command itself reported a handled failure. Treat the rendered CLI failure as
 * the source of truth: it must never receive the green capability receipt.
 */
function renderedToolFailure(part: ToolPartLike): boolean {
  if (FAILED_STATES.has(part.state ?? "")) return true;
  const value = part.output;
  const text =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "text" in value
        ? (value as { text?: unknown }).text
        : undefined;
  return (
    typeof text === "string" &&
    /(?:✖|failed to|request failed|self_signed_cert_in_chain)/i.test(text)
  );
}

/**
 * The settled tool calls in a message that render as bespoke domain-capability
 * cards (task #12), in first-seen order. The complement of the activity groups:
 * a call is EITHER a capability card OR an activity line, never both.
 */
export function toCapabilityCalls(
  message: PartsView,
): Array<{ id: string; call: CapabilityToolCall }> {
  const result: Array<{ id: string; call: CapabilityToolCall }> = [];
  for (const rawPart of message.parts) {
    const part = rawPart as ToolPartLike;
    const name = partToolName(part);
    if (!name) continue;
    const call = partToCall(part, name);
    if (!hasCapabilityCard(call)) continue;
    result.push({ id: part.toolCallId ?? `${name}:${result.length}`, call });
  }
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
  return result?.card === "traces" ? result.payload.traces.length : 0;
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
function selectTraceCards(
  entries: Array<{ id: string; call: CapabilityToolCall }>,
): Array<{ id: string; call: CapabilityToolCall }> {
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
};

/**
 * The capability calls that are still RUNNING, in first-seen order.
 *
 * The complement of {@link toCapabilityCalls}: a capability is a card for its
 * whole life — pending shell while it runs, settled card once output lands —
 * so it is never demoted to a generic activity line on the way.
 */
export function toPendingCapabilities(message: PartsView): PendingCapability[] {
  const pending: PendingCapability[] = [];
  for (const rawPart of message.parts) {
    const part = rawPart as ToolPartLike;
    const name = partToolName(part);
    if (!name) continue;
    if (DONE_STATES.has(part.state ?? "")) continue;
    const progress = resolveCapabilityProgress(name);
    if (!progress) continue;
    pending.push({
      id: part.toolCallId ?? `${name}:${pending.length}`,
      progress,
      detail: describeToolCall({ name, input: part.input }).detail,
      command: commandOfToolCall({ name, input: part.input }),
    });
  }
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
export function toFailedToolCalls(message: PartsView): FailedToolCall[] {
  const failures: FailedToolCall[] = [];
  for (const rawPart of message.parts) {
    const part = rawPart as ToolPartLike;
    if (!renderedToolFailure(part)) continue;
    const name = partToolName(part);
    if (!name) continue;
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
    });
  }
  return failures;
}

/**
 * Collapse a message's tool parts into ordered activity groups. First-seen
 * order is preserved; a group is `done` only once every tool call in it has
 * settled, so a group with any in-flight call still reads as pending.
 */
export function toActivityGroups(message: PartsView): ActivityGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, ActivityGroup>();

  for (const rawPart of message.parts) {
    const part = rawPart as ToolPartLike;
    // The plan tool (`todowrite`/`todoread`) is NEVER an activity card — it is
    // the checklist itself (LangyPlanCard), so it must not also collapse into a
    // shimmering "Planning…" row.
    if (isPlanToolPart(part)) continue;
    const name = partToolName(part);
    if (!name) continue;

    // A tool call whose output is a staged proposal renders as a ProposalCard.
    if (isProposalOutput(part.output)) continue;
    // A failed call has its own red error card, including structured trace/log
    // actions. It must never get the green checkmark of a completed activity.
    if (renderedToolFailure(part)) continue;
    // A call whose name maps to a capability is a CARD for its whole life —
    // the pending shell while it runs, the bespoke card once it settles. Only a
    // failed one falls back here (there is no result to draw, so raw JSON is
    // the honest answer).
    const isKnownCapability = resolveCapability(name) !== null;
    if (
      (isKnownCapability && !DONE_STATES.has(part.state ?? "")) ||
      hasCapabilityCard(partToCall(part, name))
    ) {
      continue;
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
    } else {
      order.push(key);
      byKey.set(key, {
        key,
        label: described.title,
        detail: described.detail,
        done,
        calls: [call],
      });
    }
  }

  return order.map((key) => byKey.get(key)!);
}

export function LangyToolActivity({ message }: { message: UIMessage }) {
  return <LangyActivityParts parts={message.parts} />;
}

/**
 * Render a set of tool parts as activity — the reusable spine shared by a whole
 * message (LangyToolActivity) and one plan step's attributed calls
 * (LangyPlanCard). Renders nothing when the parts carry no activity, so a bucket
 * with only prose collapses to nothing.
 */
export function LangyActivityParts({ parts }: PartsView) {
  const [devMode] = useLangyDevMode();
  const turnProgress = useLangyStore((state) => state.turnProgress);
  const turnProgressSample = useLangyStore((state) => state.turnProgressSample);
  const view: PartsView = { parts };
  const groups = toActivityGroups(view);
  const runningGroups = groups.filter((group) => !group.done);
  const completedGroups = groups.filter((group) => group.done);
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

  return (
    <VStack align="stretch" gap={2} aria-label="Langy activity">
      {failures.map(({ id, call, presentation }) => (
        <FailedToolCallRow
          key={id}
          call={call}
          presentation={presentation}
          devMode={devMode}
        />
      ))}
      {runningGroups.length > 0 ? (
        <VStack align="stretch" gap={2} role="list">
          {runningGroups.map((group) => (
            <ActivityCard key={group.key} group={group} devMode={devMode} />
          ))}
        </VStack>
      ) : null}
      {completedGroups.length === 1 ? (
        <ActivityCard group={completedGroups[0]!} devMode={devMode} />
      ) : completedGroups.length > 1 ? (
        <CompletedActivityBatch groups={completedGroups} />
      ) : null}
      {capabilityBatches.map((batch) => (
        <CapabilityBatchRow key={batch.key} batch={batch} devMode={devMode} />
      ))}
      {pending.map(({ id, progress, detail, command }, index) => (
        <LangyCapabilityPendingCard
          key={id}
          surface={progress.surface}
          overline={progress.overline}
          headline={progress.headline}
          detail={detail}
          command={command}
          progress={index === pending.length - 1 ? turnProgress : null}
          progressSample={
            index === pending.length - 1 ? turnProgressSample : null
          }
        />
      ))}
    </VStack>
  );
}

/**
 * The implementation trail is one receipt, not one card per mechanism. Hover
 * previews it; click pins it open for touch/keyboard users.
 */
function CompletedActivityBatch({ groups }: { groups: ActivityGroup[] }) {
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
  const callCount = groups.reduce(
    (count, group) => count + group.calls.length,
    0,
  );

  return (
    <VStack align="stretch" gap={1.5}>
      <chakra.button
        type="button"
        width="full"
        paddingX={3}
        paddingY={2.5}
        borderWidth="1px"
        borderColor={open ? "border.emphasized" : "border.muted"}
        borderRadius="langyCard"
        background="bg.subtle"
        textAlign="left"
        cursor="pointer"
        aria-expanded={open}
        onClick={() => {
          userToggled.current = true;
          setOpen((value) => !value);
        }}
      >
        <HStack gap={2}>
          <Box color="green.fg" display="flex" flexShrink={0}>
            <Check size={11} />
          </Box>
          <Text textStyle="xs" fontWeight="560" color="fg" flex={1} truncate>
            {groups.length} actions completed
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
          paddingX={3}
          paddingY={1}
          borderLeftWidth="1px"
          borderColor="border.muted"
          marginLeft={3}
          role="list"
        >
          {groups.map((group) => (
            <HStack key={group.key} gap={2} paddingY={1.5} role="listitem">
              <Text textStyle="xs" color="fg" fontWeight="520" flex={1}>
                {completedActivityLabel(group.label)}
              </Text>
              {group.detail ? (
                <Text
                  textStyle="2xs"
                  color="fg.subtle"
                  fontFamily="mono"
                  maxWidth="52%"
                  truncate
                >
                  {group.detail}
                </Text>
              ) : null}
            </HStack>
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

type CapabilityCallEntry = ReturnType<typeof toCapabilityCalls>[number];
type CapabilityBatch = {
  key: string;
  entries: CapabilityCallEntry[];
  label: string;
};

/**
 * Repeated capability calls are one piece of work, not a deck of cards. Group
 * them by semantic result (surface + tone + noun); the receipt stays compact
 * and the original cards remain one click away for inspection.
 */
function batchCapabilityCalls(
  entries: CapabilityCallEntry[],
): CapabilityBatch[] {
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
      existing.label = capabilityBatchLabel(
        descriptor,
        existing.entries.length,
      );
      continue;
    }
    order.push(key);
    batches.set(key, {
      key,
      entries: [entry],
      label: capabilityBatchLabel(descriptor, 1),
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
  const [open, setOpen] = useState(true);
  const userToggled = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!userToggled.current) setOpen(false);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, []);
  if (batch.entries.length === 1) {
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
            <CapabilityCardRow
              key={entry.id}
              call={entry.call}
              devMode={devMode}
            />
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
        <LangyToolErrorCard presentation={presentation} />
        {devMode ? (
          <Box position="absolute" top={2} right={2}>
            <Tooltip
              content={open ? "Hide raw data" : "Show raw data"}
              showArrow
            >
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
  const [open, setOpen] = useState(true);
  return (
    <VStack align="stretch" gap={1}>
      <Box position="relative">
        <LangyCapabilityRenderer call={call} />
        {devMode ? (
          <Box position="absolute" top={2} right={2}>
            <Tooltip
              content={open ? "Hide raw data" : "Show raw data"}
              showArrow
            >
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
 * One activity group, as a CARD.
 *
 * It used to be naked text — a bare word ("Coding") floating in the message
 * column with a `{}` blob of raw tool JSON hanging off it, shown to everyone.
 * Now it speaks the same card language as every capability: the tool/skill NAME
 * on the overline, the activity as the title, and the concrete thing being done
 * (the command, the path, the pattern) underneath in mono.
 *
 * The raw payload is DEVELOPER MODE ONLY — there is no `{}` affordance at all
 * for a normal user, whichever tool it is. An unmapped tool is not a licence to
 * dump JSON in someone's chat; its name and its input are the honest answer.
 */
function ActivityCard({
  group,
  devMode,
}: {
  group: ActivityGroup;
  devMode: boolean;
}) {
  const reduce = useReducedMotion();
  // Show the completed receipt long enough to read, then return the transcript
  // to a compact state. A deliberate click cancels the automatic collapse.
  const [open, setOpen] = useState(group.done);
  const userToggled = useRef(false);
  useEffect(() => {
    if (!group.done) return;
    const timer = window.setTimeout(() => {
      if (!userToggled.current) setOpen(false);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [group.done]);
  const detail = group.detail;
  const shimmer = reduce
    ? { ...langyThinkingShimmerStyles, animation: "none" }
    : langyThinkingShimmerStyles;

  if (group.done && !open) {
    return (
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
        aria-expanded="false"
        onClick={() => {
          userToggled.current = true;
          setOpen(true);
        }}
        _hover={{ borderColor: "border.emphasized" }}
      >
        <HStack gap={2}>
          <Box color="green.fg" display="flex" flexShrink={0}>
            <Check size={11} />
          </Box>
          <Text textStyle="xs" fontWeight="560" color="fg" flex={1} truncate>
            {completedActivityLabel(group.label)}
          </Text>
          {group.detail ? (
            <Text
              textStyle="2xs"
              fontFamily="mono"
              color="fg.subtle"
              maxWidth="42%"
              truncate
            >
              {group.detail}
            </Text>
          ) : null}
          <Box color="fg.subtle" display="flex">
            <ChevronRight size={12} />
          </Box>
        </HStack>
      </chakra.button>
    );
  }

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
      <HStack
        gap={1.5}
        align="center"
        cursor={group.done ? "pointer" : undefined}
        onClick={
          group.done
            ? () => {
                userToggled.current = true;
                setOpen(false);
              }
            : undefined
        }
      >
        {group.done ? (
          <Box color="green.fg" display="flex" flexShrink={0}>
            <Check size={11} />
          </Box>
        ) : (
          <Box
            width="6px"
            height="6px"
            borderRadius="full"
            background="orange.solid"
            flexShrink={0}
            css={
              reduce
                ? undefined
                : { animation: `${dotPulse} 1.4s ease-in-out infinite` }
            }
          />
        )}
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
        ) : null}
      </HStack>

      <Box
        textStyle="sm"
        fontWeight="640"
        lineHeight="1.3"
        color={group.done ? "fg" : undefined}
        css={group.done ? undefined : shimmer}
      >
        {group.done ? group.label : `${group.label}…`}
      </Box>

      {detail ? (
        <Text textStyle="2xs" fontFamily="mono" color="fg.subtle" truncate>
          {detail}
        </Text>
      ) : null}

      {devMode && open ? (
        <VStack align="stretch" gap={1}>
          {group.calls.map((call, index) => (
            <RawCallJson key={call.toolCallId ?? index} call={call} />
          ))}
        </VStack>
      ) : null}
    </VStack>
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
