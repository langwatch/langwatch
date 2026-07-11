/**
 * Compact tool-call activity for an assistant turn.
 *
 * The Langy worker streams its CLI/tool calls into the assistant message as
 * AI-SDK tool parts (`tool-<name>` / `dynamic-tool`, each with a `state`).
 * This renders them as the reference's `.status` lines: a burst of raw tools
 * collapses into one human activity ("Coding", "Analysing traces") rather than
 * a wall of tool ids, in-flight lines show a pulsing brand dot, and finished
 * ones flip to a green check.
 *
 * No-UI-yet + developer mode: a tool call the frontend has no rich mapping for
 * falls back to its raw JSON (name, state, input, output) inline — the "just
 * show the JSON" path. Developer mode (`useLangyDevMode`) exposes that same raw
 * view for the tools that DO have a card, so the whole event stream behind a
 * turn is inspectable. When the backend later drives the UI itself (sending a
 * schema'd descriptor of which component + values to render, rather than the
 * frontend mapping a tool name), that descriptor plugs in where the JSON
 * fallback is today; until then, JSON is the honest fallback.
 *
 * Kept in its own component (not inside MessageContent) so the shared turn
 * renderer stays a single insertion point. GitHub git/gh milestones ride the
 * separate pill-track (LangyGitHubProgressCard); proposal-producing tool
 * outputs render as their own ProposalCard and are skipped here.
 *
 * Build reference: "Langy — The Full Experience" (GitHub + tool-call mapping).
 */
import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import type { UIMessage } from "ai";
import { Braces, Check } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useLangyDevMode } from "../hooks/useLangyDevMode";
import { isProposalOutput } from "./capabilities/capabilityRegistry";
import {
  type CapabilityToolCall,
  hasCapabilityCard,
  LangyCapabilityRenderer,
} from "./capabilities/LangyCapabilityRenderer";

const dotPulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.72); }
`;

// A raw tool id maps to the human activity it belongs to; several tools share
// one `key` so consecutive read/edit/bash calls read as a single "Coding" line.
type Activity = { key: string; label: string };

const TOOL_ACTIVITY: Record<string, Activity> = {
  search_traces: { key: "traces", label: "Analysing traces" },
  get_trace: { key: "traces", label: "Analysing traces" },
  read: { key: "code", label: "Coding" },
  write: { key: "code", label: "Coding" },
  edit: { key: "code", label: "Coding" },
  multiedit: { key: "code", label: "Coding" },
  patch: { key: "code", label: "Coding" },
  bash: { key: "code", label: "Coding" },
  list: { key: "code", label: "Coding" },
  glob: { key: "code", label: "Coding" },
  grep: { key: "code", label: "Coding" },
  search: { key: "search", label: "Searching" },
  webfetch: { key: "web", label: "Reading the web" },
  fetch: { key: "web", label: "Reading the web" },
  todowrite: { key: "plan", label: "Planning" },
  todoread: { key: "plan", label: "Planning" },
};

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
const DONE_STATES = new Set(["output-available", "output-error", "output-denied"]);

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
  label: string;
  done: boolean;
  /** False when no TOOL_ACTIVITY mapping exists — render the JSON fallback. */
  known: boolean;
  calls: ToolCall[];
};

/** The tool name behind a part: `dynamic-tool` carries it, `tool-<name>` encodes it. */
function partToolName(part: ToolPartLike): string | undefined {
  const type = part.type;
  if (!type) return undefined;
  if (type === "dynamic-tool") return part.toolName;
  if (type.startsWith("tool-")) return type.slice("tool-".length);
  return undefined;
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

/**
 * True when a message has anything for LangyToolActivity to render — an
 * activity line OR a capability card. MessageContent uses this in its
 * "is there anything to show?" guard so a turn whose only output is a settled
 * capability card (no prose, no proposal) still renders.
 */
export function hasLangyActivity(message: UIMessage): boolean {
  return (
    toCapabilityCalls(message).length > 0 || toActivityGroups(message).length > 0
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

    // A tool call whose output is a staged proposal renders as a ProposalCard,
    // and one whose name maps to a settled domain card renders as that card —
    // both are surfaced elsewhere, so skip them here to avoid double-surfacing.
    if (isProposalOutput(part.output)) continue;
    if (hasCapabilityCard(partToCall(part, name))) continue;

    const mapped = TOOL_ACTIVITY[name];
    const key = mapped?.key ?? `tool:${name}`;
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
      // Any still-running call in the group keeps the whole group pending.
      existing.done = existing.done && done;
      existing.calls.push(call);
    } else {
      order.push(key);
      byKey.set(key, {
        key,
        label: mapped?.label ?? humanizeTool(name),
        done,
        known: !!mapped,
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
  if (groups.length === 0 && capabilityCalls.length === 0) return null;

  return (
    <VStack align="stretch" gap={2} aria-label="Langy activity">
      {groups.length > 0 ? (
        <VStack align="stretch" gap={1.5} role="list">
          {groups.map((group) => (
            <ActivityRow key={group.key} group={group} devMode={devMode} />
          ))}
        </VStack>
      ) : null}
      {capabilityCalls.map(({ id, call }) => (
        <CapabilityCardRow key={id} call={call} devMode={devMode} />
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

function ActivityRow({
  group,
  devMode,
}: {
  group: ActivityGroup;
  devMode: boolean;
}) {
  const reduce = useReducedMotion();
  // Unmapped tools have no card, so the raw JSON IS their UI — start it open.
  // Mapped tools only get the raw toggle in developer mode, collapsed.
  const [open, setOpen] = useState(!group.known);
  const canInspect = devMode || !group.known;

  return (
    <VStack align="stretch" gap={1} role="listitem">
      <HStack gap={2} align="center">
        {group.done ? (
          <Box color="green.fg" display="flex">
            <Check size={12} />
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
          textStyle="xs"
          color={group.done ? "fg.muted" : "fg"}
          fontWeight={group.done ? "400" : "500"}
          flex={1}
          minWidth={0}
        >
          {group.label}
        </Text>
        {canInspect ? (
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
      {canInspect && open ? (
        <VStack align="stretch" gap={1} paddingLeft="20px">
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

/** `format_code` / `run-tests` → "Format code" / "Run tests". */
function humanizeTool(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").trim();
  if (!spaced) return "Working";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
