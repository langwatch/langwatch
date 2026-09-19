import { useCallback, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  requoteBareTerms,
  splitBareWords,
} from "~/server/app-layer/traces/query-language/mutations";
import type { RouteSearchResult } from "~/server/app-layer/traces/search-router/route-search";
import { api } from "~/utils/api";
import { useFilterStore } from "../../stores/filterStore";
import { useViewStore } from "../../stores/viewStore";
import type { InstantEvalRoutePayload } from "../TracesPage/useInstantEvalRoute";

interface UseSubmitSearchOptions {
  /** Whether the Langy route is open to this user. */
  langyAvailable: boolean;
  /** Sample data is client fixtures; a routed search has nothing to run on. */
  isSamplePreview: boolean;
  /** Hands the sentence to Langy as a question. */
  onLangy: (question: string) => void;
  onInstantEval: (payload: InstantEvalRoutePayload) => void;
  /** Enter fell back to a phrase because no model could route it. */
  onModelUnavailable: () => void;
}

/**
 * What Enter does with the text in the search bar.
 *
 * A text without bare words is a filter and is applied as typed. A text with
 * bare words is a sentence and goes to `tracesV2.routeSearch`, which answers
 * with one of four routes; each is applied here so the result is visible on
 * screen. A failure on the way is never an error state in the bar: the
 * sentence is searched as one quoted phrase instead.
 *
 * Spec: specs/traces-v2/search.feature ("Enter routes a sentence").
 */
export function useSubmitSearch({
  langyAvailable,
  isSamplePreview,
  onLangy,
  onInstantEval,
  onModelUnavailable,
}: UseSubmitSearchOptions): {
  submitSearch: (text: string) => void;
  isRouting: boolean;
} {
  const { project } = useOrganizationTeamProject();
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const recordAiTranslation = useFilterStore((s) => s.recordAiTranslation);
  const routeSearch = api.tracesV2.routeSearch.useMutation();
  // A second Enter before the first answer arrives supersedes it: only the
  // latest submit may touch the store.
  const submitSeqRef = useRef(0);

  const applyRoute = useCallback(
    ({
      result,
      text,
      projectId,
      timeRange,
    }: {
      result: RouteSearchResult;
      text: string;
      projectId: string;
      timeRange: { from: number; to: number };
    }) => {
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
          if (result.modelUnavailable) onModelUnavailable();
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
    [
      applyQueryText,
      recordAiTranslation,
      onInstantEval,
      onLangy,
      onModelUnavailable,
    ],
  );

  const submitSearch = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const seq = ++submitSeqRef.current;
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
          lensId: useViewStore.getState().activeLensId,
          langyAvailable,
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
      langyAvailable,
      project?.id,
      routeSearch,
    ],
  );

  return { submitSearch, isRouting: routeSearch.isPending };
}
