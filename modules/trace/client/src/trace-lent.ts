/** Trace UI that reads trace's own data, lent by token to the modules that show it (§10, §10.1). */

import { uiTokens } from "@langwatch/module";
import type {
  AnnotationQueueConversationProps,
  RenderInputOutputProps,
  SetupWithAgentButtonProps,
  TraceEditButtonProps,
  TraceIdPeekProps,
} from "@langwatch/trace-contract";
import type { ConversationRoleMode, DisplayPart } from "@langwatch/trace-contract/conversation";
import type { ComponentType, ReactElement, ReactNode } from "react";

/** What a surface hands trace's agent actions menu: copy a prompt, ask Langy, or read docs. */
export type AgentActionsMenuProps = {
  /** Labels the default outline button. Ignored when `trigger` is given. */
  triggerLabel?: string;
  /** The surface's own trigger: one element, because `Menu.Trigger asChild` clones it. */
  trigger?: ReactElement;
  /** Match the sibling buttons of the surface this sits in. */
  size?: "sm" | "md";
  /** Null where the surface knows Langy is out of reach; otherwise `useCanAskLangy` decides. */
  langy: {
    prompt: string;
    label: string;
    hint: string;
    /** Takes the prompt instead of the Langy store, for a surface animating its own composer. */
    onAsk?: (prompt: string) => void;
  } | null;
  copy: {
    /** What the reader gets while the skill is on its way; absent, the setup prompt of `skill`. */
    prompt?: string;
    label: string;
    hint: string;
    copiedTitle: string;
    /** The skill whose instructions the copy carries, when there is one. */
    skill?: string;
    /** A freshly minted token to put in front of those instructions. */
    apiKey?: string;
    /** The endpoint that token belongs to, on a self-hosted deployment. */
    endpoint?: string;
  };
  docs: {
    href: string;
    label: string;
    hint: string;
    /** Overrides the book glyph where the surface reads better with another. */
    icon?: ComponentType<{ size?: number }>;
  };
};

/** The part of an audio element playback drives; structural, so no DOM type is named. */
export type ConversationAudioElement = {
  readonly paused: boolean;
  pause(): void;
  play(): Promise<void>;
};

/** Playback for one audio part, as the host's sequential player hands it out. */
export type ConversationAudioPlayback = {
  ref: (element: ConversationAudioElement | null) => void;
  onPlay: () => void;
  onEnded: () => void;
};

/** Draws one media part; the host owns stored-object probing and playback. */
export type RenderConversationMediaPart = (input: {
  part: Extract<DisplayPart, { kind: "media" }>["part"];
  projectId: string;
  audioPlayback?: ConversationAudioPlayback;
}) => ReactNode;

/** What a screen hands trace's conversation renderer: parts flattened by the trace kit. */
export type ConversationThreadProps = {
  parts: DisplayPart[];
  /** `compact` is a grid-cell preview: smaller type, no turn separators. */
  variant?: "compact" | "regular";
  /** `scenario` swaps the sides so the agent under test reads as the subject. */
  roleMode?: ConversationRoleMode;
  labels?: { user?: string; assistant?: string };
  /** Owns the stored objects behind any media parts. */
  projectId: string;
  renderPartActions?: (part: DisplayPart) => ReactNode;
  shouldAutoScroll?: boolean;
  /** Draws a reply that parses as JSON as a value tree, not markdown. */
  shouldRenderStructuredOutput?: boolean;
  panel?: { contentMaxWidth: string };
  /** A reply was asked for and has not begun arriving. */
  hasPendingReply?: boolean;
  /** Numbers turns from the start and offers trace affordances as traces land. */
  live?: boolean;
  renderMediaPart: RenderConversationMediaPart;
  renderTurnSeparator?: (input: { index: number; traceId?: string; live: boolean }) => ReactNode;
  audioPlaybackFor?: (part: DisplayPart) => ConversationAudioPlayback | undefined;
};

/** What a screen hands trace's hover peek around a trigger of its own. */
export type TracePreviewHoverCardProps = {
  traceId: string;
  children: ReactNode;
};

const trace = uiTokens("trace");

export const RenderInputOutputToken = trace.component<RenderInputOutputProps>("renderInputOutput");
export const TraceIdPeekToken = trace.component<TraceIdPeekProps>("traceIdPeek");
export const SetupWithAgentButtonToken =
  trace.component<SetupWithAgentButtonProps>("setupWithAgentButton");
export const AnnotationQueueConversationToken = trace.component<AnnotationQueueConversationProps>(
  "annotationQueueConversation",
);
export const TraceEditButtonToken = trace.component<TraceEditButtonProps>("traceEditButton");
export const AgentActionsMenuToken = trace.component<AgentActionsMenuProps>("agentActionsMenu");
export const ConversationThreadToken =
  trace.component<ConversationThreadProps>("conversationThread");
export const TracePreviewHoverCardToken =
  trace.component<TracePreviewHoverCardProps>("tracePreviewHoverCard");
