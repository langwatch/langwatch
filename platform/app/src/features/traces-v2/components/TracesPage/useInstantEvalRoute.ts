import { type MutableRefObject, useCallback, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { explainAnyError, readHandledError } from "~/features/errors";
import type { InstantEvalSearchTarget } from "~/server/app-layer/traces/ai-query";
import {
  instantEvalChipText,
  instantEvalRunKey,
  queryWithoutInstantEvalChips,
} from "~/server/app-layer/traces/query-language/instantEvalChips";
import { combineQueries } from "~/server/app-layer/traces/query-language/mutations";
import type { ModelTrouble } from "~/server/app-layer/traces/search-router/contracts";
import { api } from "~/utils/api";
import { useExplorerStore } from "../../stores/explorerStore";
import type { InstantEvalConfirmation } from "./InstantEvalConfirmDialog";
import type { InstantEvalRefusal } from "./InstantEvalRefusalPopover";

/**
 * What the search router hands over when Enter on a sentence is a judgement
 * each trace needs. Everything the Explorer needs to start the run is here:
 * the question as the judge will read it, the unit it judges (from the lens
 * the search ran in), the explicit terms typed next to the sentence, and the
 * phrase search to fall back to when the run does not start.
 */
export interface InstantEvalRoutePayload {
  projectId: string;
  /** The sentence as typed, bare words only. */
  sentence: string;
  question: {
    instructions: string;
    /**
     * What counts as yes, and what counts as no, in that order. Written by
     * the classifier for a routed sentence; absent for a question typed as
     * a chip, which the judge reads as it is.
     */
    criteria?: [string, string];
  };
  target: InstantEvalSearchTarget;
  /** The explicit `field:value` terms typed alongside the sentence. */
  otherQuery: string;
  /** The sentence quoted as one phrase, merged with `otherQuery`. */
  fallbackQuery: string;
  timeRange: { from: number; to: number };
  /**
   * Set when the question is the sentence as typed because no model rewrote
   * it. The run is the same run either way; this is what the strip under the
   * bar reads to say so, and to offer the model settings.
   */
  modelTrouble?: ModelTrouble;
  /** The handled code of that failure, when it carried one. */
  modelErrorCode?: string;
}

/**
 * Under this estimate a run starts on its own; at or over it, the dialog
 * asks first. In United States dollars.
 */
export const INSTANT_EVAL_AUTO_RUN_USD = 0.5;

/**
 * The refusal codes that get a popover of their own, rather than the
 * registry's copy.
 *
 * The flag-off case never reaches here: {@link bailUnreleased} catches it
 * client-side before any request goes out. So a `not_enabled` refusal that
 * does arrive is from a released project the deployment cannot judge yet —
 * no classifier configured — the same case as `classifier_unavailable`, and
 * gets the same popover.
 */
function refusalOf({ error }: { error: unknown }): InstantEvalRefusal | null {
  const handled = readHandledError(error);
  if (!handled) return null;
  if (handled.code === "instant_eval_free_budget_exhausted") {
    return { kind: "budget" };
  }
  if (
    handled.code === "instant_eval_not_enabled" ||
    handled.code === "instant_eval_classifier_unavailable"
  ) {
    return { kind: "model" };
  }
  return null;
}

export interface InstantEvalRouteState {
  onInstantEvalRoute: (payload: InstantEvalRoutePayload) => void;
  /**
   * Drops an estimate or a start still in flight, and closes the dialog and
   * the popover with it. Called at the head of every submit: a search that
   * lands on another route never reaches {@link onInstantEvalRoute}, so
   * without this an estimate from the search before it would still come back,
   * start a run and put its chip over what the reader is now looking at.
   */
  abandonPendingRun: () => void;
  /** The dialog's content while the cost rule asks, or null. */
  confirmation: InstantEvalConfirmation | null;
  confirmRun: () => void;
  /** The phrase search, from the dialog or the popover. */
  searchWordsInstead: () => void;
  /** The popover's content while a refusal is shown, or null. */
  refusal: InstantEvalRefusal | null;
  dismissRefusal: () => void;
  isEstimating: boolean;
  isStarting: boolean;
}

/** The payload the open dialog or popover is about. */
interface PendingRoute {
  payload: InstantEvalRoutePayload;
  key: string;
}

/**
 * The run request the estimate and the start both send.
 *
 * The eval chips already in the bar are left out of the scope. A second
 * question judges the same rows the first one did, and the two chips
 * intersect when the list is read; sending the first chip as part of the
 * filter would ask the server to compile a judgement it has no run for. The
 * run key is computed over the same stripped filter, so a run found again is
 * the run this input would have started.
 */
function runInput(payload: InstantEvalRoutePayload) {
  return {
    projectId: payload.projectId,
    target: payload.target,
    filter: queryWithoutInstantEvalChips(payload.otherQuery),
    window: { from: payload.timeRange.from, to: payload.timeRange.to },
    question: {
      instructions: payload.question.instructions,
      ...(payload.question.criteria
        ? { criteria: payload.question.criteria }
        : {}),
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

/**
 * The dialog and the popover: what is shown, and the two ways out of it (the
 * phrase search, or a refusal that ends in the phrase search).
 */
function useInstantEvalOutcome(): {
  confirmation: InstantEvalConfirmation | null;
  setConfirmation: (value: InstantEvalConfirmation | null) => void;
  refusal: InstantEvalRefusal | null;
  setRefusal: (value: InstantEvalRefusal | null) => void;
  pendingRef: MutableRefObject<PendingRoute | null>;
  searchWordsInstead: () => void;
  refuse: (args: { error: unknown; payload: InstantEvalRoutePayload }) => void;
} {
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);
  const [confirmation, setConfirmation] =
    useState<InstantEvalConfirmation | null>(null);
  const [refusal, setRefusal] = useState<InstantEvalRefusal | null>(null);
  // A later Enter supersedes the open dialog or popover rather than racing it.
  const pendingRef = useRef<PendingRoute | null>(null);

  const searchWordsInstead = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setConfirmation(null);
    setRefusal(null);
    if (pending) applyQueryText(pending.payload.fallbackQuery);
  }, [applyQueryText]);

  const refuse = useCallback(
    ({
      error,
      payload,
    }: {
      error: unknown;
      payload: InstantEvalRoutePayload;
    }) => {
      setConfirmation(null);
      const popover = refusalOf({ error });
      if (popover) {
        setRefusal(popover);
        return;
      }
      // Any other refusal: the registry's words, and the phrase search.
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

  return {
    confirmation,
    setConfirmation,
    refusal,
    setRefusal,
    pendingRef,
    searchWordsInstead,
    refuse,
  };
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
    ...(payload.question.criteria
      ? { criteria: payload.question.criteria }
      : {}),
    rows: estimate.rows,
    isRowsCapped: estimate.isRowsCapped,
    priceUsd: estimate.priceUsd,
    ...(estimate.freeBudgetRemainingUsd === undefined
      ? {}
      : { freeBudgetRemainingUsd: estimate.freeBudgetRemainingUsd }),
  };
}

/** Starts a run and, when it is accepted, puts its chip in the bar. */
function useInstantEvalStarter({
  outcome,
  seqRef,
}: {
  outcome: ReturnType<typeof useInstantEvalOutcome>;
  seqRef: MutableRefObject<number>;
}): {
  start: ReturnType<typeof api.tracesV2.instantEval.start.useMutation>;
  applyChip: (args: PendingRoute & { runId: string }) => void;
  startRun: (args: PendingRoute & { seq: number }) => void;
} {
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);
  const registerEvalRun = useExplorerStore((s) => s.registerEvalRun);
  const recordSearchNotice = useExplorerStore((s) => s.recordSearchNotice);
  const start = api.tracesV2.instantEval.start.useMutation();
  const { pendingRef, setConfirmation, refuse } = outcome;

  const applyChip = useCallback(
    ({ payload, key, runId }: PendingRoute & { runId: string }) => {
      const lensId = useExplorerStore.getState().activeLensId;
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
      // After the apply, and against the text the store settled on rather
      // than the text handed to it: the strip shows while the bar still holds
      // the query it is about, and `applyQueryText` canonicalises what it is
      // given.
      recordSearchNotice({
        projectId: payload.projectId,
        query: useExplorerStore.getState().queryText,
        interpretedAs: "instant_eval",
        modelTrouble: payload.modelTrouble,
        ...(payload.modelErrorCode
          ? { modelErrorCode: payload.modelErrorCode }
          : {}),
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
          refuse({ error, payload });
        },
      });
    },
    [applyChip, pendingRef, refuse, seqRef, setConfirmation, start],
  );

  return { start, applyChip, startRun };
}

/**
 * The refusal for a project the flag has not been turned on for: shown
 * straight away, before any estimate goes out over a run it could never
 * start. Pending is left null, so dismissing this popover just closes it
 * rather than applying a fallback query.
 */
function bailUnreleased(
  outcome: Pick<
    ReturnType<typeof useInstantEvalOutcome>,
    "pendingRef" | "setConfirmation" | "setRefusal"
  >,
) {
  outcome.pendingRef.current = null;
  outcome.setConfirmation(null);
  outcome.setRefusal({ kind: "unreleased" });
}

/** Confirms or abandons the run sitting in the dialog. */
function useInstantEvalPendingActions({
  outcome,
  seqRef,
  startRun,
}: {
  outcome: ReturnType<typeof useInstantEvalOutcome>;
  seqRef: MutableRefObject<number>;
  startRun: (args: PendingRoute & { seq: number }) => void;
}): {
  confirmRun: () => void;
  abandonPendingRun: () => void;
} {
  const { pendingRef, setConfirmation, setRefusal } = outcome;

  const confirmRun = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    startRun({ ...pending, seq: seqRef.current });
  }, [pendingRef, seqRef, startRun]);

  const abandonPendingRun = useCallback(() => {
    seqRef.current += 1;
    pendingRef.current = null;
    setConfirmation(null);
    setRefusal(null);
  }, [pendingRef, seqRef, setConfirmation, setRefusal]);

  return { confirmRun, abandonPendingRun };
}

/**
 * Fires the estimate and, once it lands, either starts the run under the
 * cost rule or shows the confirmation dialog; a failed estimate is a
 * refusal like any other.
 */
function estimateThenRoute({
  estimate,
  route,
  seqRef,
  startRun,
  setConfirmation,
  refuse,
}: {
  estimate: ReturnType<typeof api.tracesV2.instantEval.estimate.useMutation>;
  route: PendingRoute & { seq: number };
  seqRef: MutableRefObject<number>;
  startRun: (args: PendingRoute & { seq: number }) => void;
  setConfirmation: (value: InstantEvalConfirmation | null) => void;
  refuse: (args: { error: unknown; payload: InstantEvalRoutePayload }) => void;
}) {
  const { payload, key, seq } = route;
  estimate.mutate(runInput(payload), {
    onSuccess: (result) => {
      if (seq !== seqRef.current) return;
      if (result.priceUsd < INSTANT_EVAL_AUTO_RUN_USD) {
        startRun({ payload, key, seq });
        return;
      }
      setConfirmation(confirmationOf({ payload, estimate: result }));
    },
    onError: (error) => {
      if (seq !== seqRef.current) return;
      refuse({ error, payload });
    },
  });
}

/**
 * The Explorer's handler for the `instant_eval` route: the cost rule, the
 * chip and the refusals.
 *
 * A run already registered for the scope is reused with no request. Else an
 * estimate is made; under {@link INSTANT_EVAL_AUTO_RUN_USD} the run starts,
 * otherwise the dialog asks. A started run becomes an `eval` chip beside the
 * other terms and is registered under its key, so the reads send it. A spent
 * budget or a missing judge is a popover, and every refusal ends in the
 * phrase search the router built.
 *
 * A project the flag has not been turned on for never reaches the estimate:
 * the popover shows straight away, and nothing is sent.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A run starts under
 * the cost rule", "A refusal is a popover, never an error state",
 * "Instant Evals unreleased for this project").
 */
export function useInstantEvalRoute({
  isInstantEvalAvailable,
}: {
  isInstantEvalAvailable: boolean;
}): InstantEvalRouteState {
  const estimate = api.tracesV2.instantEval.estimate.useMutation();
  const outcome = useInstantEvalOutcome();
  const { pendingRef, setConfirmation, setRefusal, refuse } = outcome;
  const seqRef = useRef(0);
  const { start, applyChip, startRun } = useInstantEvalStarter({
    outcome,
    seqRef,
  });
  const { confirmRun, abandonPendingRun } = useInstantEvalPendingActions({
    outcome,
    seqRef,
    startRun,
  });

  const onInstantEvalRoute = useCallback(
    (payload: InstantEvalRoutePayload) => {
      ++seqRef.current;
      if (!isInstantEvalAvailable) {
        bailUnreleased(outcome);
        return;
      }
      const seq = seqRef.current;
      const { timeRange, evalRuns } = useExplorerStore.getState();
      const key = routeRunKey({ payload, presetId: timeRange.presetId });
      pendingRef.current = { payload, key };
      setRefusal(null);
      setConfirmation(null);

      // A run already judged this scope: the chip is enough.
      const known = evalRuns[key];
      if (known) {
        pendingRef.current = null;
        applyChip({ payload, key, runId: known });
        return;
      }

      estimateThenRoute({
        estimate,
        route: { payload, key, seq },
        seqRef,
        startRun,
        setConfirmation,
        refuse,
      });
    },
    [
      applyChip,
      estimate,
      isInstantEvalAvailable,
      pendingRef,
      refuse,
      setConfirmation,
      setRefusal,
      startRun,
    ],
  );

  return {
    onInstantEvalRoute,
    abandonPendingRun,
    confirmation: outcome.confirmation,
    confirmRun,
    searchWordsInstead: outcome.searchWordsInstead,
    refusal: outcome.refusal,
    dismissRefusal: outcome.searchWordsInstead,
    isEstimating: estimate.isPending,
    isStarting: start.isPending,
  };
}
