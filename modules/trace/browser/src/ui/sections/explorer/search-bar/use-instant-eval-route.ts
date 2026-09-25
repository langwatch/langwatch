/**
 * The Explorer's handler for the `instant_eval` route: a known run is reused,
 * else an estimate decides between an auto-start and the dialog, a started run
 * becomes an `eval` chip, and every refusal ends in the phrase search.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { toaster } from "@langwatch/design-system/toaster";
import { useFilterStore, useViewStore } from "@langwatch/trace-browser-kit";
import {
  type ExplorerInstantEvalEstimate,
  combineQueries,
  instantEvalChipText,
  instantEvalRunKey,
  queryWithoutInstantEvalChips,
} from "@langwatch/trace-contract";
import { type RefObject, useCallback, useRef, useState } from "react";

import { api } from "../../../../behavior/trace-api.ts";
import type { InstantEvalRoutePayload } from "../../../../model/instant-eval-route.ts";
import { explainAnyError } from "../../errors/index.ts";
import type { InstantEvalConfirmation } from "../instant-eval-confirm-dialog.tsx";

/**
 * Under this estimate a run starts on its own; at or over it, the dialog
 * asks first. In United States dollars.
 */
export const INSTANT_EVAL_AUTO_RUN_USD = 0.5;

export interface InstantEvalRouteState {
  onInstantEvalRoute: (payload: InstantEvalRoutePayload) => void;
  /**
   * Drops an estimate or a start still in flight, and closes the dialog with
   * it. Called at the head of every submit, so an estimate from the search
   * before cannot come back and put its chip over the new one.
   */
  abandonPendingRun: () => void;
  /** The dialog's content while the cost rule asks, or null. */
  confirmation: InstantEvalConfirmation | null;
  confirmRun: () => void;
  /** The phrase search, from the dialog or a refusal. */
  searchWordsInstead: () => void;
  isEstimating: boolean;
  isStarting: boolean;
}

/** The payload the open dialog is about. */
interface PendingRoute {
  payload: InstantEvalRoutePayload;
  key: string;
}

/**
 * The run request the estimate and the start both send. The eval chips
 * already in the bar are left out of the scope: a second question judges the
 * rows the first one did, and the two chips intersect when the list is read.
 */
function runInput(payload: InstantEvalRoutePayload) {
  return {
    projectId: payload.projectId,
    target: payload.target,
    filter: queryWithoutInstantEvalChips(payload.otherQuery),
    window: { from: payload.timeRange.from, to: payload.timeRange.to },
    question: {
      instructions: payload.question.instructions,
      ...(payload.question.criteria ? { criteria: payload.question.criteria } : {}),
    },
  };
}

/** The key a route's run is registered under, with the window's preset. */
function routeRunKey({
  payload,
  presetId,
}: {
  payload: InstantEvalRoutePayload;
  presetId: string | undefined;
}): string {
  return instantEvalRunKey({
    question: payload.question.instructions,
    target: payload.target,
    otherQuery: queryWithoutInstantEvalChips(payload.otherQuery),
    window: {
      from: payload.timeRange.from,
      to: payload.timeRange.to,
      ...(presetId ? { presetId } : {}),
    },
  });
}

/** What the dialog shows when the estimate is at or over the auto-run line. */
function confirmationOf({
  payload,
  estimate,
}: {
  payload: InstantEvalRoutePayload;
  estimate: {
    rows: number;
    isRowsCapped: boolean;
    priceUsd: number;
    freeBudgetRemainingUsd?: number;
  };
}): InstantEvalConfirmation {
  return {
    question: payload.question.instructions,
    ...(payload.question.criteria ? { criteria: payload.question.criteria } : {}),
    rows: estimate.rows,
    isRowsCapped: estimate.isRowsCapped,
    priceUsd: estimate.priceUsd,
    ...(estimate.freeBudgetRemainingUsd === undefined
      ? {}
      : { freeBudgetRemainingUsd: estimate.freeBudgetRemainingUsd }),
  };
}

/** The dialog and the refusal: what is shown, and the way out of both. */
function useInstantEvalOutcome(): {
  confirmation: InstantEvalConfirmation | null;
  setConfirmation: (value: InstantEvalConfirmation | null) => void;
  pendingRef: RefObject<PendingRoute | null>;
  searchWordsInstead: () => void;
  refuse: (args: { error: unknown }) => void;
} {
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const [confirmation, setConfirmation] = useState<InstantEvalConfirmation | null>(null);
  // A later Enter supersedes the open dialog rather than racing it.
  const pendingRef = useRef<PendingRoute | null>(null);

  const searchWordsInstead = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setConfirmation(null);
    if (pending) applyQueryText(pending.payload.fallbackQuery);
  }, [applyQueryText]);

  const refuse = useCallback(
    ({ error }: { error: unknown }) => {
      setConfirmation(null);
      const { title, description } = explainAnyError(error);
      toaster.create({
        title,
        ...(description ? { description } : {}),
        type: "warning",
      });
      searchWordsInstead();
    },
    [searchWordsInstead],
  );

  return { confirmation, setConfirmation, pendingRef, searchWordsInstead, refuse };
}

/** Starts a run and, when it is accepted, puts its chip in the bar. */
function useInstantEvalStarter({
  outcome,
  seqRef,
}: {
  outcome: ReturnType<typeof useInstantEvalOutcome>;
  seqRef: RefObject<number>;
}): {
  isStarting: boolean;
  applyChip: (args: PendingRoute & { runId: string }) => void;
  startRun: (args: PendingRoute & { seq: number }) => void;
} {
  const start = api.traces.instantEval.start.useMutation();
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const registerEvalRun = useFilterStore((s) => s.registerEvalRun);
  const recordSearchNotice = useFilterStore((s) => s.recordSearchNotice);
  const { pendingRef, setConfirmation, refuse } = outcome;

  const applyChip = useCallback(
    ({ payload, key, runId }: PendingRoute & { runId: string }) => {
      const lensId = useViewStore.getState().activeLensId;
      registerEvalRun({ key, runId });
      applyQueryText(
        combineQueries({
          base: payload.otherQuery,
          addition: instantEvalChipText({
            question: payload.question.instructions,
            target: payload.target,
            lensId,
          }),
        }),
      );
      if (!payload.modelTrouble) return;
      // Against the text the store settled on: the strip shows while the bar holds it.
      recordSearchNotice({
        projectId: payload.projectId,
        query: useFilterStore.getState().queryText,
        interpretedAs: "instant_eval",
        modelTrouble: payload.modelTrouble,
        ...(payload.modelErrorCode ? { modelErrorCode: payload.modelErrorCode } : {}),
      });
    },
    [applyQueryText, recordSearchNotice, registerEvalRun],
  );

  const startRun = useCallback(
    ({ payload, key, seq }: PendingRoute & { seq: number }) => {
      start.mutate(runInput(payload), {
        onSuccess: (run) => {
          if (seq !== seqRef.current) return;
          pendingRef.current = null;
          setConfirmation(null);
          applyChip({ payload, key, runId: run.id });
        },
        onError: (error) => {
          if (seq !== seqRef.current) return;
          refuse({ error });
        },
      });
    },
    [applyChip, pendingRef, refuse, seqRef, setConfirmation, start],
  );

  return { isStarting: start.isPending, applyChip, startRun };
}

export function useInstantEvalRoute(): InstantEvalRouteState {
  const estimate = api.traces.instantEval.estimate.useMutation();
  const outcome = useInstantEvalOutcome();
  const { pendingRef, setConfirmation, refuse } = outcome;
  const seqRef = useRef(0);
  const { isStarting, applyChip, startRun } = useInstantEvalStarter({ outcome, seqRef });

  const confirmRun = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    startRun({ ...pending, seq: seqRef.current });
  }, [pendingRef, startRun]);

  const abandonPendingRun = useCallback(() => {
    seqRef.current += 1;
    pendingRef.current = null;
    setConfirmation(null);
  }, [pendingRef, setConfirmation]);

  // Under the auto-run line the run starts; at or over it the dialog asks.
  const answerEstimate = useCallback(
    ({
      payload,
      key,
      seq,
      estimate: result,
    }: PendingRoute & { seq: number; estimate: ExplorerInstantEvalEstimate }) => {
      if (seq !== seqRef.current) return;
      if (result.priceUsd < INSTANT_EVAL_AUTO_RUN_USD) {
        startRun({ payload, key, seq });
        return;
      }
      setConfirmation(confirmationOf({ payload, estimate: result }));
    },
    [setConfirmation, startRun],
  );

  const askForEstimate = useCallback(
    ({ payload, key, seq }: PendingRoute & { seq: number }) => {
      estimate.mutate(runInput(payload), {
        onSuccess: (result) => answerEstimate({ payload, key, seq, estimate: result }),
        onError: (error) => {
          if (seq !== seqRef.current) return;
          refuse({ error });
        },
      });
    },
    [answerEstimate, estimate, refuse],
  );

  const onInstantEvalRoute = useCallback(
    (payload: InstantEvalRoutePayload) => {
      const seq = ++seqRef.current;
      const { timeRange, evalRuns } = useFilterStore.getState();
      const key = routeRunKey({ payload, presetId: timeRange.presetId });
      pendingRef.current = { payload, key };
      setConfirmation(null);

      // A run already judged this scope: the chip is enough.
      const known = evalRuns[key];
      if (known) {
        pendingRef.current = null;
        applyChip({ payload, key, runId: known });
        return;
      }
      askForEstimate({ payload, key, seq });
    },
    [applyChip, askForEstimate, pendingRef, setConfirmation],
  );

  return {
    onInstantEvalRoute,
    abandonPendingRun,
    confirmation: outcome.confirmation,
    confirmRun,
    searchWordsInstead: outcome.searchWordsInstead,
    isEstimating: estimate.isPending,
    isStarting,
  };
}
