import { useCallback, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  type InstantEvalChipTarget,
  queryWithoutInstantEvalChip,
  resolveInstantEvalChips,
} from "~/server/app-layer/traces/query-language/instantEvalChips";
import {
  requoteBareTerms,
  splitBareWords,
} from "~/server/app-layer/traces/query-language/mutations";
import type {
  RouteSearchResult,
  SearchRouteKind,
} from "~/server/app-layer/traces/search-router/contracts";
import { api } from "~/utils/api";
import { useExplorerStore } from "../../stores/explorerStore";
import type { InstantEvalRoutePayload } from "../TracesPage/useInstantEvalRoute";

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
   * of every submit, whatever the new text turns out to be: only the
   * `instant_eval` route reaches `onInstantEval`, so a filter, a phrase or a
   * Langy answer would otherwise leave the previous estimate free to come
   * back and charge for a run over results nobody is looking at.
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
}: Pick<
  UseSubmitSearchOptions,
  "onLangy" | "onInstantEval" | "onModelUnavailable"
>): (submit: RoutedSubmit) => void {
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);
  const recordAiTranslation = useExplorerStore((s) => s.recordAiTranslation);
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
    [
      applyQueryText,
      recordAiTranslation,
      onInstantEval,
      onLangy,
      onModelUnavailable,
    ],
  );
}

/**
 * The run a typed eval chip asks for, or null when every chip of the query
 * already has one.
 *
 * The question is judged as written: it came from the reader, not from a
 * sentence the router had to rewrite, so no model stands between Enter and
 * the estimate. The criteria are left to the judge's defaults for the same
 * reason. The fallback is the query as typed, because a refusal must leave the
 * chip where the reader put it rather than turn it into a phrase search.
 *
 * Read from the store at submit time rather than from the debounced copy: the
 * chip the reader just typed has to be matched against the window and the
 * lens the search is about to run in.
 */
function typedEvalRunOf({
  queryText,
  projectId,
}: {
  queryText: string;
  projectId: string;
}): InstantEvalRoutePayload | null {
  const { activeLensId, timeRange, evalRuns } = useExplorerStore.getState();
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
  const target: InstantEvalChipTarget = pending.target;
  return {
    projectId,
    sentence: pending.question,
    question: { instructions: pending.question },
    target,
    otherQuery: queryWithoutInstantEvalChip({
      queryText,
      question: pending.question,
    }),
    fallbackQuery: queryText,
    timeRange: { from: timeRange.from, to: timeRange.to },
  };
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
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);
  const routeSearch = api.tracesV2.routeSearch.useMutation();
  // A second Enter before the first answer arrives supersedes it: only the
  // latest submit may touch the store.
  const submitSeqRef = useRef(0);
  const applyRoute = useApplyRoute({
    onLangy,
    onInstantEval,
    onModelUnavailable,
  });

  const route = useCallback(
    ({
      text,
      seq,
      projectId,
      options,
    }: {
      text: string;
      seq: number;
      projectId: string;
      options?: SubmitSearchOptions;
    }) => {
      // Read at submit time: the range the user sees is the one the search
      // runs in, not the debounced copy a pending timer may still hold.
      const { timeRange, queryText } = useExplorerStore.getState();
      const range = { from: timeRange.from, to: timeRange.to };
      routeSearch.mutate(
        {
          projectId,
          text,
          timeRange: range,
          activeQuery: queryText,
          lensId: useExplorerStore.getState().activeLensId,
          isLangyAvailable,
          ...(options?.forceKind ? { forceKind: options.forceKind } : {}),
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
    [applyQueryText, applyRoute, isLangyAvailable, routeSearch],
  );

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
        // A query of explicit terms is applied as typed and needs no router,
        // with one exception: an `eval` chip is a filter over the verdicts of
        // a run, so a chip typed by hand filters on nothing until a run has
        // answered it. Enter starts that run, under the same estimate and
        // cost rule a routed sentence gets.
        if (!project?.id || isSamplePreview) return;
        const run = typedEvalRunOf({
          queryText: trimmed,
          projectId: project.id,
        });
        if (run) onInstantEval(run);
        return;
      }
      if (!project?.id || isSamplePreview) {
        applyQueryText(requoteBareTerms(trimmed));
        return;
      }
      route({
        text: trimmed,
        seq,
        projectId: project.id,
        ...(options ? { options } : {}),
      });
    },
    [
      applyQueryText,
      isSamplePreview,
      onInstantEval,
      onSupersede,
      project?.id,
      route,
    ],
  );

  return { submitSearch, isRouting: routeSearch.isPending };
}
