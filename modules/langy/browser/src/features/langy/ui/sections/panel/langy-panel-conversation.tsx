import { IsolatedErrorBoundary } from "@langwatch/browser-host/isolated-error-boundary";
import { Box, chakra, HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { EmptyState, SIDEBAR_PANEL_WIDTH, useReducedMotion } from "@langwatch/langy-browser-kit";
import type { GuidedKickoffInput } from "@langwatch/onboarding-browser-kit";
import type { UIMessage } from "ai";
import { ArrowDown, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentProps, Fragment, type ReactNode } from "react";

import { LangyModelProviderSetup } from "../../../../../ui/sections/model-provider-setup.tsx";
import type { LangyErrorPresentation } from "../../../behavior/logic/langy-error-explainer.ts";
import type { useLangyStickToBottom } from "../../../behavior/use-langy-stick-to-bottom.ts";
import { ConversationSkeleton, skeletonMessageCount } from "../conversation-skeleton.tsx";
import { GuidedTourCard } from "../derived-cards/guided-tour-card.tsx";
import { LangyCardGallery } from "../langy-card-gallery.tsx";
import { LangyError } from "../langy-error.tsx";
import { MessageContent } from "../message-content.tsx";
import { panelGutter } from "./langy-panel-chrome.ts";

const MotionBox = motion.create(Box);

// Content dissolves at the column's edges instead of hard-clipping against the
// header and composer seams; the top mask only once something is scrolled off.
const EDGE_MASK_SCROLLED =
  "linear-gradient(to bottom, transparent 0, black 28px, black calc(100% - 18px), transparent 100%)";
const EDGE_MASK_AT_TOP =
  "linear-gradient(to bottom, black 0, black calc(100% - 18px), transparent 100%)";

type StickToBottom = ReturnType<typeof useLangyStickToBottom>;
type ErrorAction = NonNullable<LangyErrorPresentation["action"]>["kind"];

/**
 * The conversation's scroller, with the ambient wash and the way back to the live edge as its
 * SIBLINGS, so neither scrolls nor repaints on scroll. The wrapper carries the wash's fade; the
 * wash keeps its own near-nothing opacity in CSS.
 */
export function LangyConversationScroller({
  floating,
  showWash,
  scroll,
  scrolledFromTop,
  children,
}: {
  floating: boolean;
  showWash: boolean;
  scroll: StickToBottom;
  scrolledFromTop: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const mask = scrolledFromTop ? EDGE_MASK_SCROLLED : EDGE_MASK_AT_TOP;
  return (
    <Box position="relative" flex={1} minHeight={0} display="flex" flexDirection="column">
      <MotionBox
        position="absolute"
        inset={0}
        overflow="hidden"
        pointerEvents="none"
        aria-hidden
        initial={false}
        animate={{ opacity: showWash ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeInOut" }}
      >
        <Box className="langy-wash" />
      </MotionBox>
      <Box
        ref={scroll.scrollRef}
        position="relative"
        flex={1}
        minHeight={0}
        overflowY="auto"
        overscrollBehaviorY="none"
        aria-live="polite"
        // Focusable, so the column answers PageUp/PageDown/Home/End.
        tabIndex={0}
        role="log"
        aria-label="Langy conversation"
        css={{ "&:focus-visible": { outline: "none" }, maskImage: mask, WebkitMaskImage: mask }}
      >
        {/* The ResizeObserver's subject: `flow-root` (floating) or a filling flex
            column (docked) so a child's margin can't collapse through it. */}
        <Box
          ref={scroll.contentRef}
          display={floating ? "flow-root" : "flex"}
          flexDirection="column"
          minHeight={floating ? undefined : "100%"}
        >
          {children}
          {/* The live edge: a smooth scrollIntoView on it follows the stream. */}
          <Box ref={scroll.endRef} height="1px" aria-hidden />
        </Box>
      </Box>
      <JumpToLatest visible={!scroll.isPinned && scroll.canScroll} onClick={scroll.jumpToLatest} />
    </Box>
  );
}

/** The way back to the live edge. */
function JumpToLatest({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {visible ? (
        <MotionBox
          position="absolute"
          bottom="10px"
          left="50%"
          zIndex={2}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          style={{ x: "-50%" }}
        >
          <chakra.button
            type="button"
            onClick={onClick}
            aria-label="Jump to latest"
            display="inline-flex"
            alignItems="center"
            gap={1.5}
            height="28px"
            paddingLeft={2.5}
            paddingRight={3}
            borderRadius="full"
            borderWidth="1px"
            borderStyle="solid"
            borderColor="border"
            background="bg.surface/90"
            color="fg.muted"
            textStyle="2xs"
            fontWeight="500"
            cursor="pointer"
            css={{ backdropFilter: "blur(10px)" }}
            transition="color 130ms ease, border-color 130ms ease"
            _hover={{ color: "fg", borderColor: "border.emphasized" }}
          >
            <ArrowDown size={12} />
            Jump to latest
          </chakra.button>
        </MotionBox>
      ) : null}
    </AnimatePresence>
  );
}

/** The recents list failed while the panel was open: one calm, dismissable card at the top. */
export function LangyListErrorCard({
  floating,
  presentation,
  onRetry,
  onDismiss,
}: {
  floating: boolean;
  presentation: LangyErrorPresentation;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const gutter = panelGutter(floating);
  const inset = floating ? "25px" : "20px";
  return (
    <Box position="relative" paddingX={gutter} paddingTop={gutter}>
      <LangyError
        presentation={presentation}
        onAction={(kind) => {
          if (kind === "retry") onRetry();
        }}
      />
      <IconButton
        aria-label="Dismiss"
        size="2xs"
        variant="ghost"
        color="fg.muted"
        position="absolute"
        top={inset}
        right={inset}
        onClick={onDismiss}
      >
        <X size={13} />
      </IconButton>
    </Box>
  );
}

/**
 * A refresh of the open conversation failed while it is still on screen: one line, no card. While
 * a turn runs the poll clears it on its own; on a settled conversation it carries the retry.
 */
export function LangyHistoryStaleLine({
  floating,
  retryIsComing,
  onRetry,
}: {
  floating: boolean;
  retryIsComing: boolean;
  onRetry: () => void;
}) {
  const gutter = panelGutter(floating);
  return (
    <HStack
      data-testid="langy-history-stale"
      gap={1.5}
      align="baseline"
      paddingX={gutter}
      paddingTop={gutter}
    >
      <Text textStyle="2xs" color="fg.subtle">
        Showing the messages we last loaded. This conversation couldn&apos;t be refreshed.
      </Text>
      {retryIsComing ? null : (
        <chakra.button
          type="button"
          onClick={onRetry}
          flexShrink={0}
          borderWidth={0}
          background="transparent"
          color="orange.fg"
          cursor="pointer"
          textStyle="2xs"
          fontWeight="560"
          _hover={{ textDecoration: "underline" }}
        >
          Try again
        </chakra.button>
      )}
    </HStack>
  );
}

/** An error card inset to the column's measure. */
export function LangyColumnError({
  floating,
  presentation,
  onAction,
  testId,
}: {
  floating: boolean;
  presentation: LangyErrorPresentation;
  onAction: (kind: ErrorAction) => void;
  testId?: string;
}) {
  const gutter = panelGutter(floating);
  return (
    <VStack data-testid={testId} align="stretch" paddingX={gutter} paddingTop={gutter}>
      <LangyError presentation={presentation} onAction={onAction} />
    </VStack>
  );
}

/** What the column shows when it is not a transcript, in priority order. */
export interface LangyColumnState {
  showCardGallery: boolean;
  /** No model resolves, or a dead codex session is being signed in again. */
  modelSetup: { reconnectCodex: boolean; onComplete: () => void } | null;
  /** A conversation we could not READ is not one with nothing in it: ahead of the empty state. */
  blockingHistoryError: LangyErrorPresentation | null;
  onHistoryErrorAction: (kind: ErrorAction) => void;
  /** Restoring a conversation whose messages have not arrived: its shape, not an invitation. */
  restoring: { messageCount: number | null } | null;
  /**
   * The guided tour card, before the kickoff message exists: in progress while the tour runs,
   * settled once it ended and the kickoff only waits to send. Never the invitation instead.
   */
  tourCard: { kickoff: GuidedKickoffInput | null; organizationId: string | null } | null;
  /** A queued question counts as content, so the empty state never shows over it. */
  empty: {
    panelWidth: number;
    suggestions: ComponentProps<typeof EmptyState>["suggestions"];
    onPick: (prompt: string) => void;
  } | null;
}

/** The message column: one state at a time, the transcript when nothing else owns it. */
export function LangyConversationBody({
  floating,
  state,
  transcript,
}: {
  floating: boolean;
  state: LangyColumnState;
  transcript: ReactNode;
}) {
  if (state.showCardGallery) return <LangyCardGallery />;
  if (state.modelSetup) return <LangyModelSetup {...state.modelSetup} />;
  if (state.blockingHistoryError) {
    return (
      <LangyColumnError
        floating={floating}
        presentation={state.blockingHistoryError}
        onAction={state.onHistoryErrorAction}
      />
    );
  }
  if (state.restoring) {
    const gutter = panelGutter(floating);
    return (
      <VStack align="stretch" paddingX={gutter} paddingTop={gutter}>
        <ConversationSkeleton
          count={skeletonMessageCount(state.restoring.messageCount)}
          dense={!floating}
        />
      </VStack>
    );
  }
  if (state.tourCard) {
    const gutter = panelGutter(floating);
    return (
      <VStack align="stretch" paddingX={gutter} paddingTop={gutter}>
        <GuidedTourCard {...state.tourCard} />
      </VStack>
    );
  }
  if (state.empty) {
    return (
      <EmptyState
        variant={floating ? "floating" : "sidebar"}
        panelWidth={floating ? state.empty.panelWidth : SIDEBAR_PANEL_WIDTH}
        suggestions={state.empty.suggestions}
        onPick={state.empty.onPick}
      />
    );
  }
  return transcript;
}

/** The inline model setup; the provider grid's own description is its only subtitle. */
function LangyModelSetup({
  reconnectCodex,
  onComplete,
}: {
  reconnectCodex: boolean;
  onComplete: () => void;
}) {
  return (
    <VStack align="stretch" gap={2} paddingX="18px" paddingTop="18px">
      <Text fontSize="sm" fontWeight="semibold">
        {reconnectCodex ? "Sign in to Codex again" : "Langy needs a model to get started"}
      </Text>
      <LangyModelProviderSetup
        {...(reconnectCodex ? { initialProviderKey: "openai_codex" } : {})}
        onComplete={onComplete}
      />
    </VStack>
  );
}

type MessageContentProps = ComponentProps<typeof MessageContent>;

/** What every message in the transcript shares; the per-message gates are derived from it. */
export type LangyMessageContext = Omit<
  MessageContentProps,
  "message" | "isStreaming" | "interrupted" | "showFeedback" | "isFeedbackPinned"
> & {
  /** A turn is streaming into the transcript's last assistant message. */
  displayBusy: boolean;
  /** The open conversation's last answer was cut off. */
  interruptedHere: boolean;
  /** Settled, live and error-free: the only moment a rating may be asked for. */
  feedbackAllowed: boolean;
  pinnedFeedbackMessageId: string | null;
};

/**
 * One message, its render crash kept its own. Only the transcript's last assistant message can be
 * streaming, interrupted, or carry the feedback card.
 */
function LangyTranscriptMessage({
  message,
  isLast,
  context,
}: {
  message: UIMessage;
  isLast: boolean;
  context: LangyMessageContext;
}) {
  const { displayBusy, interruptedHere, feedbackAllowed, pinnedFeedbackMessageId, ...shared } =
    context;
  const lastAnswer = isLast && message.role === "assistant";
  return (
    <IsolatedErrorBoundary scope="This message failed to render" resetKeys={[message.id]}>
      <MessageContent
        {...shared}
        message={message}
        isStreaming={displayBusy && lastAnswer}
        interrupted={interruptedHere && lastAnswer}
        showFeedback={feedbackAllowed && lastAnswer}
        isFeedbackPinned={pinnedFeedbackMessageId === message.id}
      />
    </IsolatedErrorBoundary>
  );
}

/**
 * The transcript. The cards a SETTLED turn raised sit inside it, above the message that closed
 * it; a running turn's cards sit at the live edge (`cardAnchorIndex` -1), where their answer goes.
 */
export function LangyTranscript({
  floating,
  messages,
  context,
  cardAnchorIndex,
  waitingCards,
  queuedPrompt,
  workingLine,
}: {
  floating: boolean;
  messages: UIMessage[];
  context: LangyMessageContext;
  cardAnchorIndex: number;
  waitingCards: ReactNode;
  queuedPrompt: string | null;
  workingLine: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const gutter = panelGutter(floating);
  return (
    <VStack
      gap={floating ? "16px" : "12px"}
      align="stretch"
      paddingX={gutter}
      paddingTop={gutter}
      paddingBottom="12px"
    >
      {messages.map((message, index) => (
        <Fragment key={message.id}>
          {index === cardAnchorIndex ? waitingCards : null}
          <LangyTranscriptMessage
            message={message}
            isLast={index === messages.length - 1}
            context={context}
          />
        </Fragment>
      ))}
      {cardAnchorIndex === -1 ? waitingCards : null}
      {queuedPrompt ? <QueuedPrompt prompt={queuedPrompt} reduceMotion={reduceMotion} /> : null}
      {workingLine}
    </VStack>
  );
}

/**
 * A question that has been asked but has not become a message yet, drawn as the real bubble
 * would appear so the swap is invisible. Spec: specs/home/langy-home-morph.feature
 */
function QueuedPrompt({ prompt, reduceMotion }: { prompt: string; reduceMotion: boolean }) {
  return (
    <MotionBox
      alignSelf="flex-end"
      maxWidth="85%"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }}
    >
      <Box
        paddingX={3}
        paddingY={2}
        background="langy.userBubbleBg"
        color="fg"
        borderWidth="1px"
        borderStyle="solid"
        borderColor="langy.userBubbleBorder"
        borderRadius="15px"
        borderBottomRightRadius="5px"
        textStyle="sm"
        lineHeight="1.5"
        whiteSpace="pre-wrap"
      >
        {prompt}
      </Box>
    </MotionBox>
  );
}
