import { useFilterStore } from "@langwatch/trace-browser-kit";
import {
  queryWithoutInstantEvalChip,
  requoteBareTerms,
  resolveInstantEvalChips,
  type RouteSearchResult,
  splitBareWords,
} from "@langwatch/trace-contract";
import { type RefObject, useCallback, useRef } from "react";

import { api } from "../../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import type { InstantEvalRoutePayload } from "../../../../model/instant-eval-route.ts";

interface UseSubmitSearchOptions {
  /** Whether the Langy route is open to this user. */
  isLangyAvailable: boolean;
  /** Sample data is client fixtures; a routed search has nothing to run on. */
  isSamplePreview: boolean;
  /** Hands the sentence to Langy as a question. */
  onLangy: (question: string) => void;
  onInstantEval: (payload: InstantEvalRoutePayload) => void;
  /**
   * Drops an Instant Eval estimate or start still in flight. Run at the head
   * of every submit: another route would otherwise leave the previous estimate
   * free to come back and charge for a run nobody is looking at.
   */
  onSupersede: () => void;
  /** Enter fell back to a phrase because no model could route it. */
  onModelUnavailable: () => void;
}

interface RoutedSubmit {
  result: RouteSearchResult;
  text: string;
  projectId: string;
  timeRange: { from: number; to: number };
}

/** Puts one router answer on screen: chips, a phrase, a question, or a run. */
function useApplyRoute({
  onLangy,
  onInstantEval,
  onModelUnavailable,
}: Pick<UseSubmitSearchOptions, "onLangy" | "onInstantEval" | "onModelUnavailable">): (
  submit: RoutedSubmit,
) => void {
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const recordAiTranslation = useFilterStore((s) => s.recordAiTranslation);
  return useCallback(
    ({ result, text, projectId, timeRange }: RoutedSubmit) => {
      switch (result.kind) {
        case "filter":
          applyQueryText(result.query);
          // Recorded after the apply, which clears the previous translation:
          // the notice under the bar reads this to say what was searched and
          // to offer the sentence back as a phrase.
          recordAiTranslation({ projectId, prompt: text, query: result.query });
          return;
        case "free_text":
          applyQueryText(result.query);
          if (result.isModelUnavailable) onModelUnavailable();
          return;
        case "langy":
          onLangy(result.question);
          return;
        case "instant_eval":
          onInstantEval({
            projectId,
            sentence: splitBareWords(text).sentence,
            question: result.question,
            target: result.target,
            otherQuery: result.otherQuery,
            fallbackQuery: result.fallbackQuery,
            timeRange,
          });
          return;
      }
    },
    [applyQueryText, recordAiTranslation, onInstantEval, onLangy, onModelUnavailable],
  );
}

/**
 * The run a typed eval chip asks for, or null when every chip already has one.
 * The question is judged as written, with no model between Enter and the
 * estimate, and the fallback is the query as typed so a refusal leaves it be.
 */
function typedEvalRunOf({
  queryText,
  projectId,
}: {
  queryText: string;
  projectId: string;
}): InstantEvalRoutePayload | null {
  // Read from the store at submit time, not from the debounced copy: the chip
  // just typed is matched against the window and lens the search will run in.
  const { activeLensId, timeRange, evalRuns } = useFilterStore.getState();
  const { chips } = resolveInstantEvalChips({
    queryText,
    lensId: activeLensId,
    window: {
      from: timeRange.from,
      to: timeRange.to,
      ...(timeRange.presetId ? { presetId: timeRange.presetId } : {}),
    },
    runsByKey: evalRuns ?? {},
  });
  const pending = chips.find((chip) => chip.runId === null);
  if (!pending) return null;
  return {
    projectId,
    sentence: pending.question,
    question: { instructions: pending.question },
    target: pending.target,
    otherQuery: queryWithoutInstantEvalChip({
      queryText,
      field: pending.field,
      question: pending.question,
    }),
    fallbackQuery: queryText,
    timeRange: { from: timeRange.from, to: timeRange.to },
  };
}

/** Sends a sentence to the router and applies the route it answers with. */
function useRouteSubmit({
  isLangyAvailable,
  onLangy,
  onInstantEval,
  onModelUnavailable,
  submitSeqRef,
}: Pick<
  UseSubmitSearchOptions,
  "isLangyAvailable" | "onLangy" | "onInstantEval" | "onModelUnavailable"
> & {
  submitSeqRef: RefObject<number>;
}): {
  route: (args: { text: string; seq: number; projectId: string }) => void;
  isRouting: boolean;
} {
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const routeSearch = api.traces.routeSearch.useMutation();
  const applyRoute = useApplyRoute({ onLangy, onInstantEval, onModelUnavailable });

  const route = useCallback(
    ({ text, seq, projectId }: { text: string; seq: number; projectId: string }) => {
      // Read at submit time: the range the user sees is the one the search
      // runs in, not the debounced copy a pending timer may still hold.
      const { timeRange, queryText } = useFilterStore.getState();
      const range = { from: timeRange.from, to: timeRange.to };
      routeSearch.mutate(
        {
          projectId,
          text,
          timeRange: range,
          activeQuery: queryText,
          lensId: useFilterStore.getState().activeLensId,
          isLangyAvailable,
        },
        {
          onSuccess: (result) => {
            if (seq !== submitSeqRef.current) return;
            applyRoute({ result, text, projectId, timeRange: range });
          },
          onError: () => {
            if (seq !== submitSeqRef.current) return;
            applyQueryText(requoteBareTerms(text));
          },
        },
      );
    },
    [applyQueryText, applyRoute, isLangyAvailable, routeSearch, submitSeqRef],
  );

  return { route, isRouting: routeSearch.isPending };
}

/**
 * What Enter does with the typed text: a filter is applied as typed, a
 * sentence goes to `traces.routeSearch`, and a failure on the way is searched
 * as one phrase rather than shown as an error. @see ADR-144
 */
export function useSubmitSearch({
  isLangyAvailable,
  isSamplePreview,
  onLangy,
  onInstantEval,
  onSupersede,
  onModelUnavailable,
}: UseSubmitSearchOptions): {
  submitSearch: (text: string) => void;
  isRouting: boolean;
} {
  const { project } = useOrganizationTeamProject();
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  // A second Enter before the first answer arrives supersedes it: only the
  // latest submit may touch the store.
  const submitSeqRef = useRef(0);
  const { route, isRouting } = useRouteSubmit({
    isLangyAvailable,
    onLangy,
    onInstantEval,
    onModelUnavailable,
    submitSeqRef,
  });

  // A query of explicit terms is applied as typed and needs no router, with
  // one exception: an `eval` chip filters on the verdicts of a run, so a chip
  // typed by hand filters on nothing until a run has answered it. Enter starts
  // that run, under the same estimate and cost rule a routed sentence gets.
  const applyFilter = useCallback(
    ({ queryText, projectId }: { queryText: string; projectId: string | null }) => {
      applyQueryText(queryText);
      if (!projectId) return;
      const run = typedEvalRunOf({ queryText, projectId });
      if (run) onInstantEval(run);
    },
    [applyQueryText, onInstantEval],
  );

  const submitSearch = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const seq = ++submitSeqRef.current;
      // Before anything else, including the early returns: an empty bar or a
      // plain filter supersedes a pending run just as a routed sentence does.
      onSupersede();
      if (!trimmed) {
        applyQueryText("");
        return;
      }
      // The sample preview has no project to search or judge in.
      const projectId = isSamplePreview ? null : (project?.id ?? null);
      const { sentence } = splitBareWords(trimmed);
      if (!sentence) {
        applyFilter({ queryText: trimmed, projectId });
        return;
      }
      if (!projectId) {
        applyQueryText(requoteBareTerms(trimmed));
        return;
      }
      route({ text: trimmed, seq, projectId });
    },
    [applyFilter, applyQueryText, isSamplePreview, onSupersede, project?.id, route],
  );

  return { submitSearch, isRouting };
}
