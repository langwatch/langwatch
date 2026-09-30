import { showErrorToast } from "@langwatch/browser-host/errors";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { useLangyStore } from "@langwatch/langy-browser-kit";
import {
  LANGY_CHOICE_SELECTION_PART_TYPE,
  type LangyChoiceSelection,
  type LangyDerivedChoicesCard,
  type LangyEventCursor,
  renderLangyChoiceSelectionText,
} from "@langwatch/langy-contract";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { api } from "../../../../behavior/langy-api.ts";
import { useLangyLocalControlStore } from "../../../../behavior/langy-local-control.store.ts";
import {
  langyPermissionCards,
  langyQuestionCards,
  langyQuestionWaitsByToolCall,
  routeLangyChoiceAnswer,
  routeLangyQuestionRefusal,
} from "../../../../model/langy-local-waits.ts";
import { parseLangyLocalWorkspace } from "../../../../model/langy-local-workspace.ts";
import { toEngineParts } from "../../model/langy-engine-parts.ts";
import { useLangyLocalRecord } from "../data/use-langy-local-record.ts";
import { useLangyDevLog } from "../stores/langy-dev-log.ts";
import { presentReadError } from "./use-langy-panel-errors.ts";

const RECORD_UNAVAILABLE = {
  kind: "langy_record_unavailable",
  title: "This conversation could not be loaded",
  description: "Anything it is waiting for you to answer is not on screen. Try again in a moment.",
};

/**
 * The developer's own machine (ADR-129): local cards read from the durable record, the folded
 * turn document, and this browser's own live wait entries, merged by a rule that only ever moves a
 * card forward. A record that cannot be read is said out loud, never read as Langy being slow.
 */
export function useLangyLocalWaits({
  projectId,
  activeConversationId,
  eventCursor,
}: {
  projectId: string | undefined;
  activeConversationId: string | null;
  eventCursor: LangyEventCursor | null;
}) {
  const turnToolCalls = useLangyStore((s) => s.turnProjection.turn?.ToolCalls ?? null);
  const liveWaits = useLangyLocalControlStore((s) => s.waits);
  // The messages poll moves the cursor while a turn runs, so the record follows at its pace.
  const localRecord = useLangyLocalRecord({
    projectId,
    conversationId: activeConversationId,
    cursor: eventCursor,
  });
  const record = localRecord.waits;
  const recordErrorPresentation = useMemo(
    () =>
      localRecord.isError
        ? presentReadError({ error: localRecord.error, fallback: RECORD_UNAVAILABLE })
        : null,
    [localRecord.isError, localRecord.error],
  );

  const sources = useMemo(
    () => ({ record, toolCalls: turnToolCalls, live: liveWaits }),
    [record, turnToolCalls, liveWaits],
  );
  const permissionCards = useMemo(() => langyPermissionCards(sources), [sources]);
  const questionWaits = useMemo(() => langyQuestionWaitsByToolCall(sources), [sources]);
  // A settled question is settled in the WAIT and nowhere else: answering one
  // writes no selection into the transcript.
  const questionCards = useMemo(() => langyQuestionCards(sources), [sources]);
  const questionCardsByToolCall = useMemo(
    () =>
      new Map(
        questionCards.flatMap((card) =>
          card.toolCallId ? [[card.toolCallId, card] as const] : [],
        ),
      ),
    [questionCards],
  );

  // A card holding the turn changes what the waiting line and the composer say.
  const awaitingAnswer =
    permissionCards.some((card) => card.status === "pending") ||
    [...questionWaits.values()].some((wait) => wait.status === "pending");

  // The live entries belong to one conversation; opening another drops them.
  useEffect(() => {
    useLangyLocalControlStore.getState().reset(activeConversationId);
  }, [activeConversationId]);

  const localWorkspace = api.langy.getLocalWorkspace.useQuery(
    { projectId: projectId ?? "", conversationId: activeConversationId ?? "" },
    { select: parseLangyLocalWorkspace, enabled: !!projectId && !!activeConversationId },
  );

  return {
    turnToolCalls,
    recordErrorPresentation,
    refetchRecord: localRecord.refetch,
    permissionCards,
    questionWaits,
    questionCards,
    questionCardsByToolCall,
    awaitingAnswer,
    workspace: localWorkspace.data,
    /** The folder read has answered once, so the waits above are a baseline, not a guess. */
    workspaceFetched: localWorkspace.isFetched,
    /** The conversation record has answered once, the other source the waiting cards read. */
    recordFetched: localRecord.isFetched,
    // The ask holding the turn is open in the sharing terminal too, so both places are named.
    terminalConnected: localWorkspace.data?.connected === true,
  };
}

type ChoiceAnswer = { selection: LangyChoiceSelection; card: LangyDerivedChoicesCard };

/** The option labels a selection picked, in the card's words. */
function selectedLabels({ selection, card }: ChoiceAnswer): string[] {
  const labelById = new Map(card.options.map((option) => [option.id, option.label]));
  return selection.optionIds.flatMap((id) => {
    const label = labelById.get(id);
    return label ? [label] : [];
  });
}

/** A refused wait answer: a real failure is shown, a settled wait never answers twice. */
function settleRefusedAnswer({
  error,
  settle,
  retry,
  sendAsMessage,
}: {
  error: unknown;
  settle: (status: "answered" | "expired") => void;
  retry: () => void;
  sendAsMessage: () => void;
}) {
  const refusal = routeLangyQuestionRefusal(readHandledError(error));
  if (refusal.kind === "failed") {
    retry();
    showErrorToast({ error, fallbackTitle: "Could not send your answer" });
    return;
  }
  if (refusal.kind === "answered") {
    settle("answered");
    return;
  }
  settle("expired");
  sendAsMessage();
}

/**
 * Answers a choices card. A question asked MID-TURN goes back to its wait (the turn keeps its
 * plan, nothing is sent); anything else — including a wait that already expired — rides the send
 * path as the next user message (ADR-060 §6). Kept stable, since it reaches every message.
 */
export function useLangyChoiceAnswer({
  projectId,
  isBusy,
  questionWaits,
  resetRecovery,
  sendMessage,
}: {
  projectId: string | undefined;
  isBusy: boolean;
  questionWaits: ReturnType<typeof langyQuestionWaitsByToolCall>;
  resetRecovery: () => void;
  sendMessage: (message: Pick<UIMessage, "role" | "parts">) => Promise<void>;
}) {
  const answerQuestion = api.langy.answerQuestion.useMutation();
  const implementationRef = useRef<(answer: ChoiceAnswer) => void>(() => undefined);
  const answeringWaits = useRef(new Set<string>());

  const sendAsMessage = ({ selection, card }: ChoiceAnswer) => {
    if (isBusy) return;
    const text = renderLangyChoiceSelectionText({
      selection,
      optionLabelById: new Map(card.options.map((option) => [option.id, option.label])),
    });
    resetRecovery();
    useLangyDevLog.getState().recordOutbound("send", `choice: ${text}`, {
      text,
      conversationId: useLangyStore.getState().activeConversationId,
    });
    void sendMessage({
      role: "user",
      // The selection part rides beside its text rendering.
      parts: toEngineParts([
        { type: LANGY_CHOICE_SELECTION_PART_TYPE, ...selection },
        { type: "text", text },
      ]),
    });
  };

  const answerWait = ({
    conversationId,
    waitId,
    answer,
  }: {
    conversationId: string;
    waitId: string;
    answer: ChoiceAnswer;
  }) => {
    if (!projectId) return;
    // The card stays open until the answer lands, so a second click must not answer twice.
    if (answeringWaits.current.has(waitId)) return;
    answeringWaits.current.add(waitId);
    const settle = (status: "answered" | "expired") =>
      useLangyLocalControlStore.getState().settleWait({ waitId, kind: "question", status });
    const { selection, card } = answer;
    const other = selection.otherText !== undefined ? { other: selection.otherText } : {};
    answerQuestion.mutate(
      {
        projectId,
        conversationId,
        waitId,
        answers: [{ question: card.question, selected: selectedLabels(answer), ...other }],
      },
      {
        onSuccess: () => settle("answered"),
        onError: (error) =>
          settleRefusedAnswer({
            error,
            settle,
            retry: () => answeringWaits.current.delete(waitId),
            sendAsMessage: () => implementationRef.current(answer),
          }),
      },
    );
  };

  implementationRef.current = (answer) => {
    if (!projectId) return;
    const conversationId = useLangyStore.getState().activeConversationId;
    const route = routeLangyChoiceAnswer({
      blockId: answer.selection.blockId,
      waits: questionWaits,
    });
    if (conversationId && route.kind === "wait") {
      answerWait({ conversationId, waitId: route.waitId, answer });
      return;
    }
    sendAsMessage(answer);
  };

  return useCallback((answer: ChoiceAnswer) => implementationRef.current(answer), []);
}
