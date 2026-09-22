import { useFilterStore } from "@langwatch/trace-browser-kit";
import {
  requoteBareTerms,
  type RouteSearchResult,
  type SearchRouteKind,
  splitBareWords,
} from "@langwatch/trace-contract";
import { useCallback, useRef } from "react";

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

/** What a caller knows about a submit the user did not type. */
export interface SubmitSearchOptions {
  /**
   * The route this text already took once. Skips the classifier, so a text
   * the page knows is a judgement is judged again rather than reclassified.
   */
  forceKind?: SearchRouteKind;
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
  submitSearch: (text: string, options?: SubmitSearchOptions) => void;
  isRouting: boolean;
} {
  const { project } = useOrganizationTeamProject();
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const routeSearch = api.traces.routeSearch.useMutation();
  // A second Enter before the first answer arrives supersedes it: only the
  // latest submit may touch the store.
  const submitSeqRef = useRef(0);
  const applyRoute = useApplyRoute({ onLangy, onInstantEval, onModelUnavailable });

  const submitSearch = useCallback(
    (text: string, options?: SubmitSearchOptions) => {
      const trimmed = text.trim();
      const seq = ++submitSeqRef.current;
      // Before anything else, including the early returns: an empty bar or a
      // plain filter supersedes a pending run just as a routed sentence does.
      onSupersede();
      if (!trimmed) {
        applyQueryText("");
        return;
      }
      const { sentence } = splitBareWords(trimmed);
      if (!sentence) {
        applyQueryText(trimmed);
        return;
      }
      if (!project?.id || isSamplePreview) {
        applyQueryText(requoteBareTerms(trimmed));
        return;
      }
      // Read at submit time: the range the user sees is the one the search
      // runs in, not the debounced copy a pending timer may still hold.
      const { timeRange, queryText } = useFilterStore.getState();
      const range = { from: timeRange.from, to: timeRange.to };
      const projectId = project.id;
      routeSearch.mutate(
        {
          projectId,
          text: trimmed,
          timeRange: range,
          activeQuery: queryText,
          lensId: useFilterStore.getState().activeLensId,
          isLangyAvailable,
          ...(options?.forceKind ? { forceKind: options.forceKind } : {}),
        },
        {
          onSuccess: (result) => {
            if (seq !== submitSeqRef.current) return;
            applyRoute({ result, text: trimmed, projectId, timeRange: range });
          },
          onError: () => {
            if (seq !== submitSeqRef.current) return;
            applyQueryText(requoteBareTerms(trimmed));
          },
        },
      );
    },
    [
      applyQueryText,
      applyRoute,
      isSamplePreview,
      isLangyAvailable,
      onSupersede,
      project?.id,
      routeSearch,
    ],
  );

  return { submitSearch, isRouting: routeSearch.isPending };
}
