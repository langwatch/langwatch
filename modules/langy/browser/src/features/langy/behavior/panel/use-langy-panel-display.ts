import { useLangyStore } from "@langwatch/langy-browser-kit";
import { isLangyHiddenLocalNotice } from "@langwatch/langy-contract";
import type { UIMessage } from "ai";
import { useMemo, useRef } from "react";

import type { LangyTurnSignals } from "../../../../behavior/use-langy-turn-signals.ts";
import { resolveLangyActivityOwnership } from "../../../../model/langy-activity-ownership.ts";
import { langyChoicesTimeline } from "../../../../model/langy-choices-timeline.ts";
import { latestCodeAccessCallId } from "../../../../model/langy-code-access-tool.ts";
import { langyPlan } from "../../../../model/langy-plan.ts";
import {
  questionToolCallIdsIn,
  questionWaitCardParts,
} from "../../../../model/langy-question-tool.ts";
import {
  currentTurnAssistant,
  hasTokens,
  langyTurnActivityKey,
  runningTool,
  settledTool,
} from "../../../../model/langy-thinking-line.ts";
import { deriveWaveActivity } from "../../../../model/langy-wave-motion.ts";
import { toEngineMessage } from "../../model/langy-engine-parts.ts";
import type { LangyMessagesResult } from "../data/use-langy-messages.ts";
import {
  isStaleLangyHistoryRead,
  type LangyErrorPresentation,
} from "../logic/langy-error-explainer.ts";
import { buildTimeTravelView, type LangyTimeTravelView } from "../logic/langy-time-travel.ts";
import { tapeForConversation, useLangyDevLog } from "../stores/langy-dev-log.ts";
import type { useLangyLocalWaits } from "./use-langy-local-waits.ts";

type LocalWaits = ReturnType<typeof useLangyLocalWaits>;

/** The live signals, or the replayed moment's while the inspector scrubs the past. */
function signalsAt({
  timeTravel,
  turnSignals,
}: {
  timeTravel: LangyTimeTravelView | null;
  turnSignals: LangyTurnSignals;
}): LangyTurnSignals {
  if (!timeTravel) return turnSignals;
  return {
    ...turnSignals,
    status: timeTravel.signals.status,
    statusIsReadiness: false,
    progress: timeTravel.signals.progress,
    progressSample: null,
    reasoning: timeTravel.signals.reasoning,
    metrics: null,
    segment: null,
  };
}

/**
 * What the panel DISPLAYS: the live conversation, or — while developer mode's scrubber is off
 * live — the conversation as it stood at that moment (langy-time-travel.ts). The platform's own
 * connect notice is left out (ADR-129): the chip and the code access card already say it.
 */
export function useLangyTimeTravelView({
  activeConversationId,
  historyMessages,
  messages,
  isBusy,
  liveTurnInFlight,
  turnSignals,
}: {
  activeConversationId: string | null;
  historyMessages: LangyMessagesResult["messages"];
  messages: UIMessage[];
  isBusy: boolean;
  liveTurnInFlight: boolean;
  turnSignals: LangyTurnSignals;
}) {
  const turnActive = useLangyStore((s) => s.turnPhase !== "idle");
  const scrubSeq = useLangyDevLog((s) => s.scrubSeq);
  const records = useLangyDevLog((s) => s.records);
  const timeTravel = useMemo(
    () =>
      buildTimeTravelView({
        records: tapeForConversation(records, activeConversationId),
        scrubSeq,
        historyMessages,
      }),
    [records, scrubSeq, historyMessages, activeConversationId],
  );
  const displayMessages = useMemo(() => {
    const shown = timeTravel ? timeTravel.messages.map(toEngineMessage) : messages;
    return shown.filter((message) => !isLangyHiddenLocalNotice(message));
  }, [timeTravel, messages]);

  return {
    timeTravel,
    displayMessages,
    displayBusy: timeTravel ? timeTravel.isTurnInFlight : isBusy,
    turnInFlight: timeTravel ? timeTravel.isTurnInFlight : liveTurnInFlight,
    /** What the fold's motion reads: the replayed turn, or a live one on either signal. */
    waveInFlight: timeTravel ? timeTravel.isTurnInFlight : isBusy || turnActive,
    displaySignals: signalsAt({ timeTravel, turnSignals }),
  };
}

/**
 * The transcript's derived reads: the choices timeline (ADR-060 §6) kept referentially stable
 * across equal rebuilds, the one live `code_access` call, and the question cards still open on a
 * wait whose `question` part has not landed in the transcript yet.
 */
export function useLangyTranscriptReads({
  displayMessages,
  questionCards,
}: {
  displayMessages: UIMessage[];
  questionCards: LocalWaits["questionCards"];
}) {
  const choicesTimelineRef = useRef<{
    key: string;
    value: ReturnType<typeof langyChoicesTimeline>;
  }>({ key: "", value: [] });
  const choicesTimeline = useMemo(() => {
    const next = langyChoicesTimeline(displayMessages);
    const key = JSON.stringify(next);
    if (key !== choicesTimelineRef.current.key) choicesTimelineRef.current = { key, value: next };
    return choicesTimelineRef.current.value;
  }, [displayMessages]);

  const liveCodeAccessCallId = useMemo(
    () => latestCodeAccessCallId(displayMessages),
    [displayMessages],
  );

  const openQuestionParts = useMemo(() => {
    const inTranscript = questionToolCallIdsIn(displayMessages);
    return questionCards
      .filter(
        (card) =>
          card.status === "pending" &&
          card.toolCallId !== null &&
          !inTranscript.has(card.toolCallId),
      )
      .flatMap((card) =>
        questionWaitCardParts({ toolCallId: card.toolCallId, questions: card.questions }),
      );
  }, [questionCards, displayMessages]);

  return { choicesTimeline, liveCodeAccessCallId, openQuestionParts };
}

/** The last assistant message in a list. */
export function latestAssistant(messages: UIMessage[]): UIMessage | undefined {
  return messages.findLast((message) => message.role === "assistant");
}

/**
 * What the running turn is doing, for the lines that say so: the plan it is holding, the clock
 * the thinking line restarts on, who owns the progress readout, and the fold's motion — all from
 * the same provable wire signals, so nothing performs work that isn't happening.
 */
export function useLangyTurnActivity({
  displayMessages,
  displayBusy,
  displaySignals,
  turnInFlight,
  waveInFlight,
  isSettling,
  hasInlineProgressOwner,
  turnToolCalls,
  permissionCards,
}: {
  displayMessages: UIMessage[];
  displayBusy: boolean;
  displaySignals: LangyTurnSignals;
  turnInFlight: boolean;
  waveInFlight: boolean;
  isSettling: boolean;
  hasInlineProgressOwner: boolean;
  turnToolCalls: LocalWaits["turnToolCalls"];
  permissionCards: LocalWaits["permissionCards"];
}) {
  // The live snapshot exists only in the tab that watched the stream; the
  // turn's durable record carries the same plan across a reload.
  const turnPlanItems = useLangyStore((s) => s.turnPlan);
  const recordedPlanItems = useLangyStore((s) => s.turnProjection.turn?.Plan ?? null);
  const livePlanItems = turnPlanItems ?? recordedPlanItems;
  const lastMessage = displayMessages.at(-1);
  const streamingMessage = lastMessage?.role === "assistant" ? lastMessage : undefined;
  // Exactly one of the pinned card and the message renders a plan.
  const pinnedPlan = displayBusy
    ? langyPlan(streamingMessage ?? { parts: [] }, { overrideItems: livePlanItems })
    : null;

  const { reasoning, status } = displaySignals;
  const turnActivityKey = useMemo(
    () =>
      langyTurnActivityKey({
        messages: displayMessages,
        toolCalls: turnToolCalls,
        waits: permissionCards,
        planItems: livePlanItems,
        reasoning,
        status,
      }),
    [displayMessages, turnToolCalls, permissionCards, livePlanItems, reasoning, status],
  );

  const currentTurnMessage = currentTurnAssistant(displayMessages);
  const turnHasVisibleOutput =
    !!runningTool(currentTurnMessage) ||
    hasTokens(currentTurnMessage) ||
    settledTool(currentTurnMessage) ||
    !!reasoning;
  const statusForDisplay = displaySignals.statusIsReadiness && turnHasVisibleOutput ? null : status;
  const metricsCount = displaySignals.metrics?.length ?? 0;
  const activityOwnership = resolveLangyActivityOwnership({
    hasInlineProgressOwner,
    turnInFlight,
    status: statusForDisplay,
    progress: displaySignals.progress,
    progressSample: displaySignals.progressSample,
    metricsCount,
  });

  return {
    pinnedPlan,
    turnActivityKey,
    activityOwnership,
    hasTurnDetail: !!statusForDisplay || displaySignals.progress !== null || metricsCount > 0,
    waveActivity: deriveWaveActivity({
      turnInFlight: waveInFlight,
      isSettling,
      hasLiveReasoning: !!reasoning,
      messages: displayMessages,
    }),
  };
}

/**
 * The column's reading of the conversation: whether it is empty, restoring, or showing a history
 * read that failed. A failed read with the transcript still HERE is stale, not lost — only a
 * failure with nothing else to show owns the column.
 */
export function langyColumnFlags({
  hasActiveConversation,
  messageCount,
  hasPendingPrompt,
  isBusy,
  turnActive,
  isLoadingHistory,
  isUnconfirmed,
  historyError,
}: {
  hasActiveConversation: boolean;
  messageCount: number;
  hasPendingPrompt: boolean;
  isBusy: boolean;
  turnActive: boolean;
  isLoadingHistory: boolean;
  isUnconfirmed: boolean;
  historyError: LangyErrorPresentation | null;
}) {
  const isEmpty = messageCount === 0;
  const working = isBusy || turnActive;
  const isHistoryStale = isStaleLangyHistoryRead({
    presentation: historyError,
    hasContentOnScreen: !isEmpty || working,
  });
  // RESTORING, not starting fresh: the panel knows a conversation is open before its read lands.
  const isRestoring =
    hasActiveConversation &&
    isEmpty &&
    !hasPendingPrompt &&
    !isBusy &&
    isLoadingHistory &&
    !isUnconfirmed;
  return {
    isEmpty,
    isHistoryStale,
    blockingHistoryError: isHistoryStale ? null : historyError,
    isRestoring,
    // While a turn is in flight the floor never falls back to the empty one.
    emptyAndSettled: isEmpty && !isBusy && !hasPendingPrompt && !isRestoring,
    // The wash earns its place on the home screen and while Langy is working.
    showWash: (isEmpty && !isRestoring) || working,
  };
}
