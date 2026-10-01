// AgentAdapter that drives Langy through the REAL product surface, over the
// same tRPC mutations and SSE subscription the browser panel uses. See
// README.md "langy-agent.ts" for the wire format and how to point it at
// a different stack.

import type { AgentAdapter, AgentInput, AgentReturnTypes } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import type { ModelMessage } from "ai";

import { APP_BASE, CONFIG } from "./config";
import { getSessionCookie, trpcMutate } from "./trpc";

interface TurnPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}
interface TurnMessage {
  role: "user" | "assistant" | "system";
  parts: TurnPart[];
}

/** One `ui` entry as the turn stream published it. */
export interface UiActionEntry {
  actionId: string;
  kind: string;
  payload: unknown;
}

/** A resource chip, as the composer attaches it to a turn. */
export interface PageContextChip {
  kind: string;
  ref?: string;
  label: string;
}

/** One tool frame on a turn stream, `start` or `end` (README.md "langy-agent.ts"). */
export interface LangyToolEvent {
  turnId: string;
  phase: "start" | "end";
  id: string;
  name: string;
  /** The command the call ran, when it ran one. */
  command: string | null;
  input: unknown;
}

/** The tool event a stream entry describes, or null for any other entry. */
export function toolEventOf({
  entry,
  turnId,
}: {
  entry: Record<string, unknown>;
  turnId: string;
}): LangyToolEvent | null {
  if (entry.type !== "tool") return null;
  const phase = entry.phase === "start" || entry.phase === "end" ? entry.phase : null;
  if (!phase) return null;
  const input = entry.input;
  const inputCommand = (input as { command?: unknown } | null | undefined)?.command;
  let command: string | null;
  if (typeof inputCommand === "string" && inputCommand) {
    command = inputCommand;
  } else if (typeof entry.command === "string" && entry.command) {
    command = entry.command;
  } else {
    command = null;
  }
  return {
    turnId,
    phase,
    id: typeof entry.id === "string" ? entry.id : "",
    name: typeof entry.name === "string" ? entry.name : "tool",
    command,
    input,
  };
}

export interface LangySessionState {
  conversationId: string | null;
  /**
   * The turn this session is streaming, or the last one it streamed. The fake
   * workbench tab dedups the actions it sees on `turnId:actionId`, the same
   * identity the panel uses, so it needs the id the send returned.
   */
  currentTurnId: string | null;
  /** Every navigate instruction, in order (README.md "langy-agent.ts"). */
  navigateHrefs: string[];
  /** Every settled bash command, in order (README.md "langy-agent.ts"). */
  toolCommands: string[];
  /** Every settled tool card's NAME, in order (README.md "langy-agent.ts"). */
  toolNames: string[];
  /** Every settled tool card's OUTPUT, in order (README.md "langy-agent.ts"). */
  toolOutputs: string[];
  /** Every tool frame, start and end, in order (README.md "langy-agent.ts"). */
  toolEvents: LangyToolEvent[];
}

/** Mirror langyChatTransport.ts's message shape: {role, parts: [{type, text}]}. */
function toTurnMessage(msg: { role: string; content: unknown }): TurnMessage {
  const role: TurnMessage["role"] =
    msg.role === "assistant" || msg.role === "system" ? msg.role : "user";
  if (typeof msg.content === "string") {
    return { role, parts: [{ type: "text", text: msg.content }] };
  }
  if (Array.isArray(msg.content)) {
    return {
      role,
      parts: msg.content
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => ({ type: "text", text: p.text })),
    };
  }
  return { role, parts: [] };
}

/**
 * The 15s×8 retry budget on `langy_turn_in_progress` outlasts the server's
 * own documented recovery windows (README.md "langy-agent.ts" for the two
 * confirmed causes and why an old, shorter budget under-retried).
 */
async function trpcMutateWithTurnLockRetry<T>({
  cookie,
  path,
  input,
}: {
  cookie: string;
  path: string;
  input: unknown;
}): Promise<T> {
  const maxAttempts = 8;
  const delayMs = 15_000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await trpcMutate<T>({ cookie, path, input });
    } catch (error) {
      const code = (error as { domainErrorCode?: string }).domainErrorCode;
      if (code !== "langy_turn_in_progress" || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("unreachable");
}

/**
 * The turn failed for a reason that says nothing about how Langy behaves.
 * Retried once instead of graded (README.md "langy-agent.ts").
 */
export function isTransientInfrastructureError(error: unknown): boolean {
  let current: unknown = error;
  for (let hops = 0; current && hops < 8; hops++) {
    if ((current as { transientInfrastructure?: boolean }).transientInfrastructure === true) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function transientInfrastructureError(message: string): Error {
  const error = new Error(message) as Error & {
    transientInfrastructure?: boolean;
  };
  error.transientInfrastructure = true;
  return error;
}

/**
 * The stream's error entry carries the handled-error JSON as a string in
 * `error`. Returns its code and tips when it parses as one, null otherwise
 * (README.md "langy-agent.ts" for why this is a standalone reader).
 */
function parseHandledStreamError(entry: {
  error?: unknown;
}): { code: string; tips: string[] } | null {
  if (typeof entry.error !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.error);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { code, tips } = parsed as { code?: unknown; tips?: unknown };
  if (typeof code !== "string") return null;
  return {
    code,
    tips: Array.isArray(tips) ? tips.filter((tip): tip is string => typeof tip === "string") : [],
  };
}

/** A cut tool output, noted for the judge (README.md "langy-agent.ts"). */
function boundOutputForJudge(output: string): string {
  const capped = output.slice(0, 8192);
  const cut = output.length > capped.length || capped.includes("more items truncated");
  if (!cut) return capped;
  return `${capped}\n\n[Display note: this tool output was reduced for display. The agent read the full payload, so data beyond what is shown here existed. A reply citing an item or a count that is not visible here is citing the reduced part, not fabricating.]`;
}

/** One settled tool call observed on the turn stream, as the panel showed it. */
export interface SettledToolCall {
  id: string;
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
}

/** How long the harness listens to one turn's stream. */
const TURN_STREAM_TIMEOUT_MS = 420_000;

/** A turn's reply, and how the turn arrived at it. */
interface TurnText {
  /** The reply, chosen the way the product chooses it (see the fold below). */
  text: string;
  /** Whether `text` is the passage the turn ENDED on (README.md "langy-agent.ts"). */
  hasEndedOnText: boolean;
}

/** The mutable fold one turn's stream parsing accumulates into (README.md "langy-agent.ts"). */
interface TurnStreamState {
  assistantText: string;
  textAfterLastTool: string;
  sawTool: boolean;
  toolSeq: number;
  streamError: string | null;
  streamErrorCode: string | null;
  sawTerminal: boolean;
}

interface TurnStreamCallbacks {
  onNavigate?: (href: string) => void;
  onNarration?: (text: string) => void;
  onSettledTool?: (call: SettledToolCall) => void;
  onToolFrame?: (event: LangyToolEvent) => void;
  onUiAction?: (entry: UiActionEntry) => void;
}

/** A `say`-tool entry: joins the passage in progress (README.md "langy-agent.ts"). */
function applySayToolEntry({
  entry,
  turnId,
  state,
  onToolFrame,
}: { entry: any; turnId: string; state: TurnStreamState } & Pick<
  TurnStreamCallbacks,
  "onToolFrame"
>): void {
  if (entry.phase === "start") {
    const said = sayTextOf(entry.input);
    if (said) {
      const separator = state.textAfterLastTool.trim() === "" ? "" : "\n\n";
      state.assistantText += separator + said;
      state.textAfterLastTool += separator + said;
    }
  }
  const toolEvent = toolEventOf({ entry, turnId });
  if (toolEvent) onToolFrame?.(toolEvent);
}

/** A settled-or-started tool call entry (README.md "langy-agent.ts"). */
function applyToolEntry({
  entry,
  turnId,
  state,
  onNarration,
  onSettledTool,
  onToolFrame,
}: { entry: any; turnId: string; state: TurnStreamState } & Pick<
  TurnStreamCallbacks,
  "onNarration" | "onSettledTool" | "onToolFrame"
>): void {
  // The passage running when this call started belongs in front of it.
  if (state.textAfterLastTool.trim() !== "") onNarration?.(state.textAfterLastTool);
  state.textAfterLastTool = "";
  state.sawTool = true;
  const toolEvent = toolEventOf({ entry, turnId });
  if (toolEvent) onToolFrame?.(toolEvent);
  if (entry.phase !== "end") return;
  state.toolSeq += 1;
  onSettledTool?.({
    id: typeof entry.id === "string" && entry.id ? entry.id : `tool-${state.toolSeq}`,
    name: typeof entry.name === "string" ? entry.name : "tool",
    input: entry.input ?? {},
    output: typeof entry.output === "string" ? entry.output : "",
    isError: entry.isError === true,
  });
}

/** An error entry, mirroring langyChatTransport.ts's "error" case (README.md "langy-agent.ts"). */
function applyErrorEntry({ entry, state }: { entry: any; state: TurnStreamState }): void {
  const parsed = parseHandledStreamError(entry);
  if (parsed?.code === "langy_github_not_connected") {
    // Mirrors the gate's install card, both text buffers (README.md "langy-agent.ts").
    const installCard = `\`\`\`langy-card\n${
      parsed.tips[0] ?? "The LangWatch GitHub App is not installed for this project."
    }\n\`\`\``;
    state.assistantText += installCard;
    state.textAfterLastTool += installCard;
    return;
  }
  state.streamError =
    typeof entry.errorText === "string"
      ? entry.errorText
      : `Langy stream error (raw: ${JSON.stringify(entry)})`;
  state.streamErrorCode = parsed?.code ?? null;
}

/** One decoded stream entry's effect on `state` (README.md "langy-agent.ts"). */
function applyTurnStreamEntry({
  entry,
  turnId,
  state,
  onNavigate,
  onNarration,
  onSettledTool,
  onToolFrame,
  onUiAction,
}: { entry: any; turnId: string; state: TurnStreamState } & TurnStreamCallbacks): void {
  if (entry.type === "delta" && typeof entry.text === "string") {
    state.assistantText += entry.text;
    state.textAfterLastTool += entry.text;
  } else if (entry.type === "tool" && entry.name === "say") {
    applySayToolEntry({ entry, turnId, state, onToolFrame });
  } else if (entry.type === "tool") {
    applyToolEntry({ entry, turnId, state, onNarration, onSettledTool, onToolFrame });
  } else if (entry.type === "error") {
    applyErrorEntry({ entry, state });
  }
  if (entry.type === "navigate" && typeof entry.href === "string") {
    onNavigate?.(entry.href);
  }
  if (entry.type === "ui" && typeof entry.actionId === "string" && typeof entry.kind === "string") {
    onUiAction?.({ actionId: entry.actionId, kind: entry.kind, payload: entry.payload });
  }
  if (entry.type === "end") state.sawTerminal = true;
  // "complete" (SSE stream finished) / "connected" / "status" carry no
  // assistant text — nothing further to accumulate.
}

/** One raw SSE frame's `data:` lines, folded into `state` (README.md "langy-agent.ts"). */
function parseTurnStreamFrame({
  rawFrame,
  turnId,
  state,
  onNavigate,
  onNarration,
  onSettledTool,
  onToolFrame,
  onUiAction,
}: { rawFrame: string; turnId: string; state: TurnStreamState } & TurnStreamCallbacks): void {
  for (const line of rawFrame.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    let entry: any;
    try {
      entry = JSON.parse(payload).json;
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    applyTurnStreamEntry({
      entry,
      turnId,
      state,
      onNavigate,
      onNarration,
      onSettledTool,
      onToolFrame,
      onUiAction,
    });
  }
}

async function streamTurnText({
  cookie,
  params,
  onNavigate,
  onNarration,
  onSettledTool,
  onToolFrame,
  onUiAction,
}: {
  cookie: string;
  params: { projectId: string; conversationId: string; turnId: string };
  /** Called for each navigate entry on the stream (live-only, never durable). */
  onNavigate?: (href: string) => void;
  /** Called for each passage BETWEEN tool calls (README.md "langy-agent.ts"). */
  onNarration?: (text: string) => void;
  /** Called for each settled tool card on the stream, in order. */
  onSettledTool?: (call: SettledToolCall) => void;
  /** Called for every tool frame, start and end, in stream order. */
  onToolFrame?: (event: LangyToolEvent) => void;
  /** The browser leg's entry point, fired synchronously (README.md "langy-agent.ts"). */
  onUiAction?: (entry: UiActionEntry) => void;
}): Promise<TurnText> {
  const input = encodeURIComponent(JSON.stringify({ json: params }));
  const res = await fetch(`${APP_BASE}/api/sse/langy.onTurnStream?input=${input}`, {
    headers: { Cookie: cookie, Accept: "text/event-stream" },
    // How long a single turn may take (README.md "langy-agent.ts").
    signal: AbortSignal.timeout(TURN_STREAM_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Langy onTurnStream -> ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const state: TurnStreamState = {
    assistantText: "",
    textAfterLastTool: "",
    sawTool: false,
    toolSeq: 0,
    streamError: null,
    streamErrorCode: null,
    sawTerminal: false,
  };
  const parseFrame = (rawFrame: string) =>
    parseTurnStreamFrame({
      rawFrame,
      turnId: params.turnId,
      state,
      onNavigate,
      onNarration,
      onSettledTool,
      onToolFrame,
      onUiAction,
    });

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      parseFrame(frame);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) parseFrame(buf);

  if (state.streamError) {
    const errorText: string = state.streamError;
    const message = `Langy turn error: ${errorText}`;
    // A worker that died mid-reply says nothing about how Langy answers, so it
    // is retried rather than graded. Any other handled code is a real outcome.
    throw state.streamErrorCode === "langy_worker_stopped"
      ? transientInfrastructureError(message)
      : new Error(message);
  }
  // Mirrors turnfold.go's text selection (README.md "langy-agent.ts").
  if (state.sawTool && state.textAfterLastTool.trim() !== "") {
    return {
      text: state.textAfterLastTool.replace(/^[\s]+/, ""),
      hasEndedOnText: true,
    };
  }
  // Whitespace is truthy, so a turn whose only deltas were blank lines would
  // otherwise be handed to the judge as a reply the user cannot see.
  if (state.assistantText.trim()) {
    return { text: state.assistantText, hasEndedOnText: !state.sawTool };
  }

  // WHICH no-text this is decides whether a judge should ever see it
  // (README.md "langy-agent.ts" for the terminal-marker distinction).
  if (state.sawTerminal) {
    throw new Error(
      "Langy turn ended with a terminal marker but no visible text — the empty-turn fallback did not fire",
    );
  }
  throw transientInfrastructureError(
    "Langy turn produced no text and never settled — the stream closed with no terminal marker (conversation lock still held, or the stack is too loaded to answer); this is an environment failure, not a reply to grade",
  );
}

/** The words a `say` tool call carries, or null when it carries none. */
function sayTextOf(input: unknown): string | null {
  const text = (input as { text?: unknown } | undefined)?.text;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

/** One thing a turn did, in the order it did it. */
type TurnSegment = { kind: "text"; narration: string } | { kind: "tool"; call: SettledToolCall };

/** The tool-result message for a batch, mirroring the server's own 8KB
 * canonical output bound (README.md "langy-agent.ts" for why it states
 * the cut rather than cutting silently). */
function pushToolResultMessage(messages: ModelMessage[], batch: SettledToolCall[]): void {
  if (batch.length === 0) return;
  messages.push({
    role: "tool",
    content: batch.map((call) => ({
      type: "tool-result" as const,
      toolCallId: call.id,
      toolName: call.name,
      output: {
        type: call.isError ? ("error-text" as const) : ("text" as const),
        value: boundOutputForJudge(call.output),
      },
    })),
  });
}

/**
 * The turn as the scenario framework receives it: what Langy wrote and what
 * it ran, interleaved the way it happened. See README.md "langy-agent.ts"
 * for why passages ride WITH their calls rather than as replies of their own.
 */
function turnMessages({
  segments,
  text,
  hasEndedOnText,
}: {
  segments: TurnSegment[];
  text: string;
  hasEndedOnText: boolean;
}): ModelMessage[] {
  const messages: ModelMessage[] = [];
  let narration: string[] = [];
  let batch: SettledToolCall[] = [];

  const flush = () => {
    if (batch.length === 0 && narration.length === 0) return;
    messages.push({
      role: "assistant",
      content: [
        ...narration.map((part) => ({ type: "text" as const, text: part })),
        ...batch.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.name,
          input: call.input,
        })),
      ],
    });
    pushToolResultMessage(messages, batch);
    narration = [];
    batch = [];
  };

  for (const segment of segments) {
    if (segment.kind === "tool") {
      batch.push(segment.call);
      continue;
    }
    // A passage after a call opens the next stretch of work, so the calls
    // already gathered close here and keep their place in front of it.
    if (batch.length > 0) flush();
    narration.push(segment.narration);
  }
  flush();

  // A turn that ran tools and then went quiet has no reply of its own: `text`
  // is the narration already recorded above, and appending it would say every
  // passage twice.
  if (hasEndedOnText || messages.length === 0) {
    messages.push({ role: "assistant", content: text });
  }
  return messages;
}

/** The adapter, plus the handles the suites and the fake tab read it through. */
export type LangyAdapter = AgentAdapter & {
  state: LangySessionState;
  /** Where a fake workbench tab attaches, mutable (README.md "langy-agent.ts"). */
  onUiAction?: (entry: UiActionEntry) => void;
  /** Called with a new conversation's id before its first turn streams
   * (README.md "langy-agent.ts"). */
  onConversationCreated?: (conversationId: string) => Promise<void> | void;
  /** Forget the conversation, so the next turn opens a new one
   * (README.md "langy-agent.ts"). */
  resetSession: () => void;
  /** Send these parts on the next turn instead of the scenario's own text
   * (README.md "langy-agent.ts"). */
  queueNextTurn: (input: { parts: Record<string, unknown>[] }) => void;
};

export function makeLangyAdapter(
  options: {
    /** The resource chips a real composer would carry (README.md "langy-agent.ts"). */
    pageContext?: PageContextChip[];
  } = {},
): LangyAdapter {
  const state: LangySessionState = {
    conversationId: null,
    currentTurnId: null,
    navigateHrefs: [],
    toolCommands: [],
    toolNames: [],
    toolOutputs: [],
    toolEvents: [],
  };
  let queuedParts: Record<string, unknown>[] | null = null;
  const adapter: AgentAdapter = {
    role: AgentRole.AGENT,
    call: async (input: AgentInput): Promise<AgentReturnTypes> => {
      const cookie = await getSessionCookie();
      // Tool traffic from earlier turns stays out of the product payload: the
      // panel transport sends only the text history, and a role:"tool" message
      // would otherwise reach the API as an empty user message.
      const scriptedMessages = input.messages
        .filter((m: any) => m.role !== "tool")
        .map((m: any) => toTurnMessage(m))
        .filter((m) => m.parts.length > 0 || m.role === "user");
      // The queued parts stay queued until a turn carrying them settles: a
      // stream that closes without a terminal marker makes the framework
      // retry the call, and that retry has to send the kickoff again rather
      // than an empty message list.
      const messages: { role: TurnMessage["role"]; parts: unknown[] }[] = queuedParts
        ? [{ role: "user", parts: queuedParts }]
        : scriptedMessages;
      // The same wire shape the panel's transport sends. idempotencyKey is
      // derived, not randomUUID()'d, so a replayed send stays deduplicated
      // (see README.md "langy-agent.ts").
      const turnInput = {
        idempotencyKey: `${input.threadId}#${messages.length}`,
        trigger: "submit-message" as const,
        messages,
        projectId: CONFIG.PROJECT_ID,
        ...(options.pageContext ? { pageContext: options.pageContext } : {}),
      };
      const { path, body } = state.conversationId
        ? {
            path: "langy.continueConversation",
            body: { ...turnInput, conversationId: state.conversationId },
          }
        : { path: "langy.createConversation", body: turnInput };

      const { conversationId, turnId } = await trpcMutateWithTurnLockRetry<{
        conversationId: string;
        turnId: string;
      }>({ cookie, path, input: body });
      const opened = state.conversationId !== conversationId;
      state.conversationId = conversationId;
      state.currentTurnId = turnId;
      if (opened) await adapterWithState.onConversationCreated?.(conversationId);

      const segments: TurnSegment[] = [];
      const settledTools: SettledToolCall[] = [];
      const { text, hasEndedOnText } = await streamTurnText({
        cookie,
        params: { projectId: CONFIG.PROJECT_ID, conversationId, turnId },
        onNavigate: (href) => state.navigateHrefs.push(href),
        onNarration: (narration) => segments.push({ kind: "text", narration }),
        onToolFrame: (event) => state.toolEvents.push(event),
        onSettledTool: (call) => {
          settledTools.push(call);
          segments.push({ kind: "tool", call });
          const command = (call.input as { command?: unknown } | null)?.command;
          if (typeof command === "string" && command) {
            state.toolCommands.push(command);
          }
          state.toolNames.push(call.name);
          state.toolOutputs.push(call.output);
        },
        // Read at fire time, not captured: a tab attaches and detaches around
        // the conversation, and a captured listener would keep answering for a
        // tab that has closed.
        onUiAction: (entry) => adapterWithState.onUiAction?.(entry),
      });
      queuedParts = null;
      if (settledTools.length === 0) {
        return { role: "assistant", content: text };
      }
      return turnMessages({ segments, text, hasEndedOnText });
    },
  };
  const adapterWithState: LangyAdapter = Object.assign(adapter, {
    state,
    resetSession: () => {
      state.conversationId = null;
      state.currentTurnId = null;
      state.navigateHrefs.length = 0;
      state.toolCommands.length = 0;
      state.toolNames.length = 0;
      state.toolOutputs.length = 0;
      state.toolEvents.length = 0;
    },
    queueNextTurn: ({ parts }: { parts: Record<string, unknown>[] }) => {
      queuedParts = parts;
    },
  });
  return adapterWithState;
}
