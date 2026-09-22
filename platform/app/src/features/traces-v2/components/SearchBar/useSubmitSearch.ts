import { type MutableRefObject, useCallback, useRef } from "react";
import { toaster } from "~/components/ui/toaster";
import { explainAnyError } from "~/features/errors";
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
import type { RouteSearchResult } from "~/server/app-layer/traces/search-router/contracts";
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
}

/** What the toast adds when the router itself could not be reached. */
const PHRASE_INSTEAD_NOTE = "The words were searched as a phrase instead.";

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
}: Pick<UseSubmitSearchOptions, "onLangy" | "onInstantEval">): (
  submit: RoutedSubmit,
) => void {
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);
  const recordAiTranslation = useExplorerStore((s) => s.recordAiTranslation);
  const recordSearchNotice = useExplorerStore((s) => s.recordSearchNotice);
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
          // A phrase the classifier picked is the right answer and says
          // nothing further. A phrase that is what is left of another route
          // gets the strip, so the quotes around the words are explained
          // rather than just appearing.
          if (result.fellBackFrom && result.modelTrouble) {
            recordSearchNotice({
              projectId,
              query: useExplorerStore.getState().queryText,
              interpretedAs: "free_text",
              modelTrouble: result.modelTrouble,
            });
          }
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
            ...(result.modelTrouble
              ? { modelTrouble: result.modelTrouble }
              : {}),
          });
          return;
      }
    },
    [
      applyQueryText,
      recordAiTranslation,
      recordSearchNotice,
      onInstantEval,
      onLangy,
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
  submitSeqRef,
}: Pick<
  UseSubmitSearchOptions,
  "isLangyAvailable" | "onLangy" | "onInstantEval"
> & {
  submitSeqRef: MutableRefObject<number>;
}): {
  route: (args: { text: string; seq: number; projectId: string }) => void;
  isRouting: boolean;
} {
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);
  const routeSearch = api.tracesV2.routeSearch.useMutation();
  const applyRoute = useApplyRoute({ onLangy, onInstantEval });

  const route = useCallback(
    ({
      text,
      seq,
      projectId,
    }: {
      text: string;
      seq: number;
      projectId: string;
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
        },
        {
          onSuccess: (result) => {
            if (seq !== submitSeqRef.current) return;
            applyRoute({ result, text, projectId, timeRange: range });
          },
          onError: (error) => {
            if (seq !== submitSeqRef.current) return;
            // The words still get searched, and the reader is told that is
            // what happened. A sentence coming back as a quoted phrase with
            // nothing said about it reads as the search having worked.
            applyQueryText(requoteBareTerms(text));
            const { title, description } = explainAnyError(error);
            toaster.create({
              title,
              description: [description, PHRASE_INSTEAD_NOTE]
                .filter(Boolean)
                .join(" "),
              type: "warning",
            });
          },
        },
      );
    },
    [applyQueryText, applyRoute, isLangyAvailable, routeSearch, submitSeqRef],
  );

  return { route, isRouting: routeSearch.isPending };
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
}: UseSubmitSearchOptions): {
  submitSearch: (text: string) => void;
  isRouting: boolean;
} {
  const { project } = useOrganizationTeamProject();
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);
  // A second Enter before the first answer arrives supersedes it: only the
  // latest submit may touch the store.
  const submitSeqRef = useRef(0);
  const { route, isRouting } = useRouteSubmit({
    isLangyAvailable,
    onLangy,
    onInstantEval,
    submitSeqRef,
  });

  // A query of explicit terms is applied as typed and needs no router, with
  // one exception: an `eval` chip is a filter over the verdicts of a run, so
  // a chip typed by hand filters on nothing until a run has answered it.
  // Enter starts that run, under the same estimate and cost rule a routed
  // sentence gets.
  const applyFilter = useCallback(
    ({
      queryText,
      projectId,
    }: {
      queryText: string;
      projectId: string | null;
    }) => {
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
    [
      applyFilter,
      applyQueryText,
      isSamplePreview,
      onSupersede,
      project?.id,
      route,
    ],
  );

  return { submitSearch, isRouting };
}
