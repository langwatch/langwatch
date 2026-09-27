import { useLangyStore } from "@langwatch/langy-browser-kit";
import type { LangyChoiceSelection, LangyDerivedChoicesCard } from "@langwatch/langy-contract";
import type { UIMessage } from "ai";
import { type ProfilerOnRenderCallback, type RefObject, useEffect, useMemo } from "react";

import type { LangyErrorPresentation } from "../../../behavior/logic/langy-error-explainer.ts";
import type { useLangyComposerModel } from "../../../behavior/panel/use-langy-composer-model.ts";
import type { useLangyLocalWaits } from "../../../behavior/panel/use-langy-local-waits.ts";
import type {
  langyColumnFlags,
  useLangyTimeTravelView,
  useLangyTranscriptReads,
  useLangyTurnActivity,
} from "../../../behavior/panel/use-langy-panel-display.ts";
import type { useLangyListError } from "../../../behavior/panel/use-langy-panel-errors.ts";
import type { LangyPanelSend } from "../../../behavior/panel/use-langy-panel-send.ts";
import type { useLangyTurnFailure } from "../../../behavior/panel/use-langy-turn-failure.ts";
import { LangyLocalWorkspaceChip } from "../langy-local-workspace-chip.tsx";
import type { LangySend } from "../langy-send-context.tsx";
import { toPendingCapabilities } from "../langy-tool-activity.tsx";
import {
  LangyColumnError,
  type LangyColumnState,
  LangyHistoryStaleLine,
  LangyListErrorCard,
  type LangyMessageContext,
} from "./langy-panel-conversation.tsx";
import { LangyTurnWorkingLine, LangyWaitingCards } from "./langy-panel-turn.tsx";
import type { useLangyProposalApply } from "./use-langy-panel-offers.ts";

type TimeTravelView = ReturnType<typeof useLangyTimeTravelView>;
type LocalWaits = ReturnType<typeof useLangyLocalWaits>;
type TurnFailure = ReturnType<typeof useLangyTurnFailure>;
type ChoiceAnswer = { selection: LangyChoiceSelection; card: LangyDerivedChoicesCard };

/** DevTools can always inspect the panel; only expensive commits are logged, only locally. */
export function langyProfilerRender(isDevelopment: boolean): ProfilerOnRenderCallback {
  return (...commit) => {
    const [id, phase, actualDuration, baseDuration, startTime, commitTime] = commit;
    if (!isDevelopment || actualDuration < 16) return;
    console.debug("[Langy profiler]", {
      id,
      phase,
      actualDuration: Math.round(actualDuration),
      baseDuration: Math.round(baseDuration),
      startTime: Math.round(startTime),
      commitTime: Math.round(commitTime),
    });
  };
}

/**
 * The setup verdict arrives async: the moment the column becomes the setup document, snap back
 * to its top, so the heading is where reading starts.
 */
export function useLangySetupScrollsToTop({
  langyNeedsModel,
  scrollRef,
}: {
  langyNeedsModel: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    if (langyNeedsModel && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [langyNeedsModel, scrollRef]);
}

/** What a card's offer sends through: the live composer send, or nothing in a replayed past. */
export function useLangyCardSend({ send, view }: { send: LangyPanelSend; view: TimeTravelView }) {
  const replaying = !!view.timeTravel;
  const isTurnInFlight = view.turnInFlight;
  return useMemo<LangySend | null>(
    () => (replaying ? null : { send: (text: string) => void send(text), isTurnInFlight }),
    [replaying, send, isTurnInFlight],
  );
}

/** The latest answer already owns the progress readout when it carries a pending capability. */
export function hasInlineProgress(latest: UIMessage | undefined): boolean {
  return latest ? toPendingCapabilities(latest).length > 0 : false;
}

/**
 * Where the waiting cards sit: at the live edge (-1) while the turn runs, or inside the turn
 * above its closing message once settled — never below the whole transcript.
 */
export function waitingCardsAnchor({
  turnInFlight,
  messages,
}: {
  turnInFlight: boolean;
  messages: UIMessage[];
}): number {
  if (turnInFlight || messages.at(-1)?.role !== "assistant") return -1;
  return messages.length - 1;
}

/** The column's state, in priority order, for `LangyConversationBody`. */
export function langyColumnState({
  showCardGallery,
  flags,
  failure,
  model,
  onHistoryErrorAction,
  restoringMessageCount,
  hasPendingPrompt,
  empty,
}: {
  showCardGallery: boolean;
  flags: ReturnType<typeof langyColumnFlags>;
  failure: TurnFailure;
  model: ReturnType<typeof useLangyComposerModel>;
  /** The history card's own retry: re-reading is the whole remedy, no turn re-runs. */
  onHistoryErrorAction: () => void;
  restoringMessageCount: number | null;
  hasPendingPrompt: boolean;
  empty: NonNullable<LangyColumnState["empty"]>;
}): LangyColumnState {
  const { reconnectCodex } = failure;
  const needsSetup = model.langyNeedsModel || reconnectCodex;
  return {
    showCardGallery,
    modelSetup: needsSetup
      ? {
          reconnectCodex,
          onComplete: () => {
            void model.refetchResolvedDefault();
            if (!reconnectCodex) return;
            // Re-authenticated: back to the conversation, re-driving the failed turn.
            failure.setReconnectCodex(false);
            failure.retryTurn();
          },
        }
      : null,
    blockingHistoryError: flags.blockingHistoryError,
    onHistoryErrorAction: (kind) => {
      if (kind === "retry") onHistoryErrorAction();
    },
    restoring: flags.isRestoring ? { messageCount: restoringMessageCount } : null,
    empty: flags.isEmpty && !hasPendingPrompt ? empty : null,
  };
}

/**
 * What every transcript message shares. Interaction is live-only: while time-travelling the cards
 * render read-only, and a rating is only ever asked for on a settled, error-free turn.
 */
export function langyMessageContext({
  live,
  isBusy,
  turnActive,
  failure,
  view,
  proposals,
  organizationId,
  activeConversationId,
  shouldAskFeedback,
  reads,
  questionWaits,
  onChoiceSelect,
  onVerifyDerivedCard,
  onAskCodeAccessAgain,
  interruptedConversationId,
  pinnedFeedbackMessageId,
}: {
  live: boolean;
  isBusy: boolean;
  turnActive: boolean;
  failure: TurnFailure;
  view: TimeTravelView;
  proposals: ReturnType<typeof useLangyProposalApply>;
  organizationId: string | undefined;
  activeConversationId: string | null;
  shouldAskFeedback: boolean;
  reads: ReturnType<typeof useLangyTranscriptReads>;
  questionWaits: LocalWaits["questionCardsByToolCall"];
  onChoiceSelect: (answer: ChoiceAnswer) => void;
  onVerifyDerivedCard: LangyMessageContext["onVerifyDerivedCard"];
  onAskCodeAccessAgain: () => void;
  interruptedConversationId: string | null;
  pinnedFeedbackMessageId: string | null;
}): LangyMessageContext {
  const settled = !isBusy && !turnActive && !failure.turnError && !failure.recovery.isRecovering;
  return {
    organizationId,
    appliedOutcomes: proposals.appliedOutcomes,
    discardedProposals: proposals.discardedProposalIds,
    applyingProposals: proposals.applyingProposalIds,
    onApply: proposals.apply,
    onDiscard: proposals.discard,
    conversationId: activeConversationId,
    displayBusy: view.displayBusy,
    interruptedHere:
      interruptedConversationId != null && interruptedConversationId === activeConversationId,
    feedbackAllowed: live && settled,
    pinnedFeedbackMessageId,
    shouldAskFeedback,
    choicesTimeline: reads.choicesTimeline,
    // A question answered back to its wait writes no selection into the transcript.
    questionWaits,
    liveCodeAccessCallId: reads.liveCodeAccessCallId,
    ...(live ? { onChoiceSelect, onVerifyDerivedCard, onAskCodeAccessAgain } : {}),
  };
}

/** The open conversation's shared-folder chip, when there is a conversation to hold one. */
export function LangyWorkspaceChipSlot({
  projectId,
  conversationId,
}: {
  projectId: string | undefined;
  conversationId: string | null;
}) {
  if (!projectId || !conversationId) return null;
  return <LangyLocalWorkspaceChip projectId={projectId} conversationId={conversationId} />;
}

/** The waiting cards, live only, and only with a conversation to answer them in. */
export function LangyWaitingCardsSlot({
  live,
  projectId,
  conversationId,
  projectSlug,
  waits,
  openQuestionParts,
  onChoiceSelect,
}: {
  live: boolean;
  projectId: string | undefined;
  conversationId: string | null;
  projectSlug: string | null;
  waits: LocalWaits;
  openQuestionParts: ReturnType<typeof useLangyTranscriptReads>["openQuestionParts"];
  onChoiceSelect: (answer: ChoiceAnswer) => void;
}) {
  if (!live || !projectId || !conversationId) return null;
  return (
    <LangyWaitingCards
      projectId={projectId}
      conversationId={conversationId}
      projectSlug={projectSlug}
      permissionCards={waits.permissionCards}
      openQuestionParts={openQuestionParts}
      workspace={waits.workspace}
      onChoiceSelect={onChoiceSelect}
    />
  );
}

/** The working lines, only while a turn is in flight. */
export function LangyTurnWorkingLineSlot({
  view,
  activity,
  waits,
  hasInlineProgressOwner,
}: {
  view: TimeTravelView;
  activity: ReturnType<typeof useLangyTurnActivity>;
  waits: LocalWaits;
  hasInlineProgressOwner: boolean;
}) {
  const warmed = useLangyStore((s) => s.warmedConversationId);
  const activeConversationId = useLangyStore((s) => s.activeConversationId);
  const pendingConversationId = useLangyStore((s) => s.pendingConversationId);
  if (!view.turnInFlight) return null;
  const workerReady =
    warmed != null && (warmed === activeConversationId || warmed === pendingConversationId);
  return (
    <LangyTurnWorkingLine
      messages={view.displayMessages}
      signals={view.displaySignals}
      ownership={activity.activityOwnership}
      hasTurnDetail={activity.hasTurnDetail}
      hasInlineProgressOwner={hasInlineProgressOwner}
      awaitingAnswer={waits.awaitingAnswer}
      terminalConnected={waits.terminalConnected}
      activityKey={activity.turnActivityKey}
      workerReady={workerReady}
    />
  );
}

/**
 * What sits above the transcript: a failed recents list (dismissable), a stale history read (one
 * quiet line — the messages below are real), and an unreadable conversation record, which means
 * a card it is waiting on may be missing from the screen.
 */
export function LangyColumnNotices({
  floating,
  listError,
  onRetryList,
  isHistoryStale,
  historyRetryIsComing,
  onRetryHistory,
  recordError,
  onRetryRecord,
}: {
  floating: boolean;
  listError: ReturnType<typeof useLangyListError>;
  onRetryList: () => void;
  isHistoryStale: boolean;
  historyRetryIsComing: boolean;
  onRetryHistory: () => void;
  recordError: LangyErrorPresentation | null;
  onRetryRecord: () => void;
}) {
  return (
    <>
      {listError.presentation ? (
        <LangyListErrorCard
          floating={floating}
          presentation={listError.presentation}
          onRetry={onRetryList}
          onDismiss={listError.dismiss}
        />
      ) : null}
      {isHistoryStale ? (
        <LangyHistoryStaleLine
          floating={floating}
          retryIsComing={historyRetryIsComing}
          onRetry={onRetryHistory}
        />
      ) : null}
      {recordError ? (
        <LangyColumnError
          testId="langy-record-unavailable"
          floating={floating}
          presentation={recordError}
          onAction={onRetryRecord}
        />
      ) : null}
    </>
  );
}
