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
import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import type { UIMessage } from "ai";
import { Braces, Check } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useLangyDevMode } from "../hooks/useLangyDevMode";
import { langyThinkingShimmerStyles } from "./langyShimmer";
import { describeToolCall, effectiveToolName } from "../logic/langyToolLabel";
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
} from "./capabilities/LangyCapabilityRenderer";

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
};

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
  };
}

/**
 * The settled tool calls in a message that render as bespoke domain-capability
 * cards (task #12), in first-seen order. The complement of the activity groups:
 * a call is EITHER a capability card OR an activity line, never both.
 */
export function toCapabilityCalls(
  message: UIMessage,
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
  return result;
}

/** A capability call still in flight — rendered as an in-progress card. */
export type PendingCapability = {
  id: string;
  progress: CapabilityProgress;
  detail?: string;
};

/**
 * The capability calls that are still RUNNING, in first-seen order.
 *
 * The complement of {@link toCapabilityCalls}: a capability is a card for its
 * whole life — pending shell while it runs, settled card once output lands —
 * so it is never demoted to a generic activity line on the way.
 */
export function toPendingCapabilities(message: UIMessage): PendingCapability[] {
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
export function hasLangyActivity(message: UIMessage): boolean {
  return (
    toCapabilityCalls(message).length > 0 ||
    toPendingCapabilities(message).length > 0 ||
    toActivityGroups(message).length > 0
  );
}

/**
 * Collapse a message's tool parts into ordered activity groups. First-seen
 * order is preserved; a group is `done` only once every tool call in it has
 * settled, so a group with any in-flight call still reads as pending.
 */
export function toActivityGroups(message: UIMessage): ActivityGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, ActivityGroup>();

  for (const rawPart of message.parts) {
    const part = rawPart as ToolPartLike;
    const name = partToolName(part);
    if (!name) continue;

    // A tool call whose output is a staged proposal renders as a ProposalCard.
    if (isProposalOutput(part.output)) continue;
    // A call whose name maps to a capability is a CARD for its whole life —
    // the pending shell while it runs, the bespoke card once it settles. Only a
    // failed one falls back here (there is no result to draw, so raw JSON is
    // the honest answer).
    const failed = FAILED_STATES.has(part.state ?? "");
    if (resolveCapability(name) !== null && !failed) continue;

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
  const [devMode] = useLangyDevMode();
  const groups = toActivityGroups(message);
  const capabilityCalls = toCapabilityCalls(message);
  const pending = toPendingCapabilities(message);
  if (
    groups.length === 0 &&
    capabilityCalls.length === 0 &&
    pending.length === 0
  ) {
    return null;
  }

  return (
    <VStack align="stretch" gap={2} aria-label="Langy activity">
      {groups.length > 0 ? (
        <VStack align="stretch" gap={2} role="list">
          {groups.map((group) => (
            <ActivityCard key={group.key} group={group} devMode={devMode} />
          ))}
        </VStack>
      ) : null}
      {capabilityCalls.map(({ id, call }) => (
        <CapabilityCardRow key={id} call={call} devMode={devMode} />
      ))}
      {pending.map(({ id, progress, detail }) => (
        <LangyCapabilityPendingCard
          key={id}
          surface={progress.surface}
          overline={progress.overline}
          headline={progress.headline}
          detail={detail}
        />
      ))}
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
  const [open, setOpen] = useState(false);
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
  const [open, setOpen] = useState(false);
  const detail = group.detail;
  const shimmer = reduce
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
      <HStack gap={1.5} align="center">
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
