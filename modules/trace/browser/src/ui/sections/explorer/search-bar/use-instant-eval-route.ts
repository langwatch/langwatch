/**
 * The Explorer's handler for the `instant_eval` route: a known run is reused,
 * else an estimate decides between an auto-start and the dialog, a started run
 * becomes an `eval` chip, and a refusal is a popover or ends in the phrase search.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { toaster } from "@langwatch/design-system/toaster";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import {
  type ExplorerInstantEvalEstimate,
  type ExplorerInstantEvalOptInAccess,
  combineQueries,
  instantEvalChipText,
  instantEvalRunKey,
  queryWithoutInstantEvalChips,
} from "@langwatch/trace-contract";
import { type RefObject, useCallback, useRef, useState } from "react";

import { useFilterStore, useViewStore } from "../../../../behavior/explorer.store.ts";
import { api } from "../../../../behavior/trace-api.ts";
import type { InstantEvalRoutePayload } from "../../../../model/instant-eval-route.ts";
import { explainAnyError } from "../../errors/index.ts";
import type { InstantEvalConfirmation } from "../instant-eval-confirm-dialog.tsx";
import type { InstantEvalRefusal } from "../instant-eval-refusal-popover.tsx";

/**
 * Under this estimate a run starts on its own; at or over it, the dialog
 * asks first. In United States dollars.
 */
const INSTANT_EVAL_AUTO_RUN_USD = 0.5;

/**
 * The refusals that get a popover of their own rather than the registry's copy. A submit made
 * while the flag read is in flight can come back `not_enabled`, which is the model popover too.
 */
function refusalOf({ error }: { error: unknown }): InstantEvalRefusal | null {
  const handled = readHandledError(error);
  if (!handled) return null;
  if (handled.code === "instant_eval_free_budget_exhausted") return { kind: "budget" };
  if (
    handled.code === "instant_eval_not_enabled" ||
    handled.code === "instant_eval_classifier_not_configured" ||
    handled.code === "instant_eval_classifier_unavailable"
  ) {
    return { kind: "model" };
  }
  return null;
}

interface InstantEvalRouteState {
  onInstantEvalRoute: (payload: InstantEvalRoutePayload) => void;
  /**
   * Drops an estimate or a start still in flight, and closes the dialog and the popover with
   * it. Called at the head of every submit, so an estimate from the search before cannot come
   * back and put its chip over the new one.
   */
  abandonPendingRun: () => void;
  /** The dialog's content while the cost rule asks, or null. */
  confirmation: InstantEvalConfirmation | null;
  confirmRun: () => void;
  /** The phrase search, from the dialog or the popover. */
  searchWordsInstead: () => void;
  /** The popover's content while a refusal is shown, or null. */
  refusal: InstantEvalRefusal | null;
  /** Closes the popover; an unreleased project has no phrase to fall back to. */
  dismissRefusal: () => void;
  /** Throws the organization's switch, then routes the held submit. */
  enableInstantEvals: () => void;
  isEnabling: boolean;
  isEstimating: boolean;
  isStarting: boolean;
}

/** The payload the open dialog or popover is about. */
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

/** The dialog and the popover: what is shown, and the way out of both. */
function useInstantEvalOutcome(): {
  confirmation: InstantEvalConfirmation | null;
  setConfirmation: (value: InstantEvalConfirmation | null) => void;
  refusal: InstantEvalRefusal | null;
  setRefusal: (value: InstantEvalRefusal | null) => void;
  pendingRef: RefObject<PendingRoute | null>;
  searchWordsInstead: () => void;
  refuse: (args: { error: unknown }) => void;
} {
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const [confirmation, setConfirmation] = useState<InstantEvalConfirmation | null>(null);
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
    ({ error }: { error: unknown }) => {
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

/**
 * The organization's switch from the `opt_in` popover: on success the access read is primed and
 * the held submit is routed; a refusal is a warning and the popover stays. Dismissing drops the
 * held submit and bumps the sequence, so a late answer to the switch routes nothing.
 */
function useInstantEvalSwitch({
  heldRef,
  seqRef,
  route,
  outcome,
}: {
  heldRef: RefObject<InstantEvalRoutePayload | null>;
  seqRef: RefObject<number>;
  route: (args: { payload: InstantEvalRoutePayload; seq: number }) => void;
  outcome: Pick<ReturnType<typeof useInstantEvalOutcome>, "setRefusal" | "searchWordsInstead">;
}): { enableInstantEvals: () => void; dismissRefusal: () => void; isEnabling: boolean } {
  const enable = api.traces.instantEval.enable.useMutation();
  const utils = api.useUtils();
  const { setRefusal, searchWordsInstead } = outcome;

  const enableInstantEvals = useCallback(() => {
    const held = heldRef.current;
    if (!held) return;
    const seq = ++seqRef.current;
    enable.mutate(
      { projectId: held.projectId },
      {
        onSuccess: (access) => {
          utils.traces.instantEval.access.setData({ projectId: held.projectId }, access);
          void utils.traces.instantEval.access.invalidate();
          if (seq !== seqRef.current) return;
          heldRef.current = null;
          setRefusal(null);
          route({ payload: held, seq });
        },
        onError: (error) => {
          if (seq !== seqRef.current) return;
          const { title, description } = explainAnyError(error);
          toaster.create({ title, ...(description ? { description } : {}), type: "warning" });
        },
      },
    );
  }, [enable, heldRef, route, seqRef, setRefusal, utils]);

  const dismissRefusal = useCallback(() => {
    seqRef.current += 1;
    heldRef.current = null;
    searchWordsInstead();
  }, [heldRef, searchWordsInstead, seqRef]);

  return { enableInstantEvals, dismissRefusal, isEnabling: enable.isPending };
}

/** The refusal an organization without Instant Evals meets, by what its reader is offered. */
function unreleasedRefusalOf(
  optInOffer: ExplorerInstantEvalOptInAccess["offer"] | undefined,
): InstantEvalRefusal {
  if (optInOffer === "enable") return { kind: "opt_in" };
  if (optInOffer === "ask_admin") return { kind: "ask_admin" };
  return { kind: "unreleased" };
}

/**
 * Refused before any estimate goes out; with nothing pending, closing only closes. Only the switch
 * has a submit to run afterwards, so only it holds the payload.
 */
function refuseUnreleased({
  payload,
  optInOffer,
  heldRef,
  outcome,
}: {
  payload: InstantEvalRoutePayload;
  optInOffer: ExplorerInstantEvalOptInAccess["offer"] | undefined;
  heldRef: RefObject<InstantEvalRoutePayload | null>;
  outcome: Pick<
    ReturnType<typeof useInstantEvalOutcome>,
    "pendingRef" | "setConfirmation" | "setRefusal"
  >;
}): void {
  outcome.pendingRef.current = null;
  outcome.setConfirmation(null);
  const refusal = unreleasedRefusalOf(optInOffer);
  heldRef.current = refusal.kind === "opt_in" ? payload : null;
  outcome.setRefusal(refusal);
}

export function useInstantEvalRoute({
  isInstantEvalAvailable,
  optInOffer,
}: {
  isInstantEvalAvailable: boolean;
  /** What the access read offers a refused reader; absent while it loads. */
  optInOffer?: ExplorerInstantEvalOptInAccess["offer"] | undefined;
}): InstantEvalRouteState {
  const estimate = api.traces.instantEval.estimate.useMutation();
  const outcome = useInstantEvalOutcome();
  const { pendingRef, setConfirmation, setRefusal, refuse } = outcome;
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
    setRefusal(null);
  }, [pendingRef, setConfirmation, setRefusal]);

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

  const heldRef = useRef<InstantEvalRoutePayload | null>(null);

  const route = useCallback(
    ({ payload, seq }: { payload: InstantEvalRoutePayload; seq: number }) => {
      const { timeRange, evalRuns } = useFilterStore.getState();
      const key = routeRunKey({ payload, presetId: timeRange.presetId });
      pendingRef.current = { payload, key };
      setConfirmation(null);
      setRefusal(null);

      // A run already judged this scope: the chip is enough.
      const known = evalRuns[key];
      if (known) {
        pendingRef.current = null;
        applyChip({ payload, key, runId: known });
        return;
      }
      askForEstimate({ payload, key, seq });
    },
    [applyChip, askForEstimate, pendingRef, setConfirmation, setRefusal],
  );

  const onInstantEvalRoute = useCallback(
    (payload: InstantEvalRoutePayload) => {
      const seq = ++seqRef.current;
      if (isInstantEvalAvailable) route({ payload, seq });
      else {
        const stable = { pendingRef, setConfirmation, setRefusal };
        refuseUnreleased({ payload, optInOffer, heldRef, outcome: stable });
      }
    },
    [isInstantEvalAvailable, optInOffer, pendingRef, route, setConfirmation, setRefusal],
  );

  const { enableInstantEvals, dismissRefusal, isEnabling } = useInstantEvalSwitch({
    heldRef,
    seqRef,
    route,
    outcome,
  });

  return {
    onInstantEvalRoute,
    abandonPendingRun,
    confirmation: outcome.confirmation,
    confirmRun,
    searchWordsInstead: outcome.searchWordsInstead,
    refusal: outcome.refusal,
    dismissRefusal,
    enableInstantEvals,
    isEnabling,
    isEstimating: estimate.isPending,
    isStarting,
  };
}
