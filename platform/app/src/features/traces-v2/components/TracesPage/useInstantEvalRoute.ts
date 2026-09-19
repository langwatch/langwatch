import { useCallback, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { explainAnyError, readHandledError } from "~/features/errors";
import type { InstantEvalSearchTarget } from "~/server/app-layer/traces/ai-query";
import {
  instantEvalChipText,
  instantEvalRunKey,
  queryWithoutInstantEvalChips,
} from "~/server/app-layer/traces/query-language/instantEvalChips";
import { combineQueries } from "~/server/app-layer/traces/query-language/mutations";
import { api } from "~/utils/api";
import { useFilterStore } from "../../stores/filterStore";
import { useViewStore } from "../../stores/viewStore";
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
    /** What counts as yes, and what counts as no, in that order. */
    criteria: [string, string];
  };
  target: InstantEvalSearchTarget;
  /** The explicit `field:value` terms typed alongside the sentence. */
  otherQuery: string;
  /** The sentence quoted as one phrase, merged with `otherQuery`. */
  fallbackQuery: string;
  timeRange: { from: number; to: number };
}

/**
 * Under this estimate a run starts on its own; at or over it, the dialog
 * asks first. In United States dollars.
 */
export const INSTANT_EVAL_AUTO_RUN_USD = 0.5;

/** The refusal codes that get a popover of their own, rather than the registry's copy. */
function refusalOf({
  error,
  question,
}: {
  error: unknown;
  question: string;
}): InstantEvalRefusal | null {
  const handled = readHandledError(error);
  if (!handled) return null;
  if (handled.code === "instant_eval_free_budget_exhausted") {
    const spent = handled.meta.spentUsd;
    const budget = handled.meta.budgetUsd;
    return {
      kind: "budget",
      question,
      spentUsd: typeof spent === "number" ? spent : 0,
      budgetUsd: typeof budget === "number" ? budget : 1,
    };
  }
  if (
    handled.code === "instant_eval_not_enabled" ||
    handled.code === "instant_eval_classifier_unavailable"
  ) {
    return { kind: "model", question };
  }
  return null;
}

export interface InstantEvalRouteState {
  onInstantEvalRoute: (payload: InstantEvalRoutePayload) => void;
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
 * Spec: specs/traces-v2/instant-eval-search.feature ("A run starts under
 * the cost rule", "A refusal is a popover, never an error state").
 */
export function useInstantEvalRoute(): InstantEvalRouteState {
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const registerEvalRun = useFilterStore((s) => s.registerEvalRun);
  const estimate = api.tracesV2.instantEval.estimate.useMutation();
  const start = api.tracesV2.instantEval.start.useMutation();
  const [confirmation, setConfirmation] =
    useState<InstantEvalConfirmation | null>(null);
  const [refusal, setRefusal] = useState<InstantEvalRefusal | null>(null);
  // The payload the open dialog or popover is about, so a later Enter
  // supersedes it rather than racing it.
  const pendingRef = useRef<{
    payload: InstantEvalRoutePayload;
    key: string;
  } | null>(null);
  const seqRef = useRef(0);

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
      const popover = refusalOf({
        error,
        question: payload.question.instructions,
      });
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

  const runInput = useCallback((payload: InstantEvalRoutePayload) => {
    return {
      projectId: payload.projectId,
      target: payload.target,
      filter: payload.otherQuery,
      window: { from: payload.timeRange.from, to: payload.timeRange.to },
      question: {
        instructions: payload.question.instructions,
        criteria: payload.question.criteria,
      },
    };
  }, []);

  const applyChip = useCallback(
    ({
      payload,
      key,
      runId,
    }: {
      payload: InstantEvalRoutePayload;
      key: string;
      runId: string;
    }) => {
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
    },
    [applyQueryText, registerEvalRun],
  );

  const startRun = useCallback(
    ({
      payload,
      key,
      seq,
    }: {
      payload: InstantEvalRoutePayload;
      key: string;
      seq: number;
    }) => {
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
    [applyChip, refuse, runInput, start],
  );

  const confirmRun = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    startRun({
      payload: pending.payload,
      key: pending.key,
      seq: seqRef.current,
    });
  }, [startRun]);

  const onInstantEvalRoute = useCallback(
    (payload: InstantEvalRoutePayload) => {
      const seq = ++seqRef.current;
      const { timeRange } = useFilterStore.getState();
      const key = instantEvalRunKey({
        question: payload.question.instructions,
        target: payload.target,
        otherQuery: queryWithoutInstantEvalChips(payload.otherQuery),
        window: {
          from: payload.timeRange.from,
          to: payload.timeRange.to,
          ...(timeRange.presetId ? { presetId: timeRange.presetId } : {}),
        },
      });
      pendingRef.current = { payload, key };
      setRefusal(null);
      setConfirmation(null);

      // A run already judged this scope: the chip is enough.
      const known = useFilterStore.getState().evalRuns[key];
      if (known) {
        pendingRef.current = null;
        applyChip({ payload, key, runId: known });
        return;
      }

      estimate.mutate(runInput(payload), {
        onSuccess: (result) => {
          if (seq !== seqRef.current) return;
          if (result.priceUsd < INSTANT_EVAL_AUTO_RUN_USD) {
            startRun({ payload, key, seq });
            return;
          }
          setConfirmation({
            question: payload.question.instructions,
            criteria: payload.question.criteria,
            rows: result.rows,
            isRowsCapped: result.isRowsCapped,
            priceUsd: result.priceUsd,
            ...(result.freeBudgetRemainingUsd === undefined
              ? {}
              : { freeBudgetRemainingUsd: result.freeBudgetRemainingUsd }),
          });
        },
        onError: (error) => {
          if (seq !== seqRef.current) return;
          refuse({ error, payload });
        },
      });
    },
    [applyChip, estimate, refuse, runInput, startRun],
  );

  return {
    onInstantEvalRoute,
    confirmation,
    confirmRun,
    searchWordsInstead,
    refusal,
    dismissRefusal: searchWordsInstead,
    isEstimating: estimate.isPending,
    isStarting: start.isPending,
  };
}
