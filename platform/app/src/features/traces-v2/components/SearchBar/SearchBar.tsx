import {
  Box,
  chakra,
  Flex,
  HStack,
  Icon,
  IconButton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertCircle, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { explainAnyError } from "~/features/errors";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  type InstantEvalExplorerStatus,
  isInstantEvalRunActive,
} from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import type { AiActionError } from "~/server/app-layer/traces/ai-query";
import { SEARCH_FIELDS } from "~/server/app-layer/traces/query-language/metadata";
import { useInstantEvalRuns } from "../../hooks/useInstantEvalRuns";
import { useTraceFacets } from "../../hooks/useTraceFacets";
import { usePreviewTracesActive } from "../../onboarding/hooks/usePreviewTracesActive";
import { useExplorerStore } from "../../stores/explorerStore";
import { useFacetHoverStore } from "../../stores/facetHoverStore";
import { useInstantEvalRunStore } from "../../stores/instantEvalRunStore";
import { useSearchSubmitRequestStore } from "../../stores/searchSubmitRequestStore";
import { AskAiButton } from "../ai/AskAiButton";
import { InstantEvalConfirmDialog } from "../TracesPage/InstantEvalConfirmDialog";
import { InstantEvalRefusalPopover } from "../TracesPage/InstantEvalRefusalPopover";
import { registerInstantEvalRoute } from "../TracesPage/instantEvalRouteBridge";
import { useInstantEvalRoute } from "../TracesPage/useInstantEvalRoute";
import { ActiveSearchEditor } from "./ActiveSearchEditor";
import { AiErrorDetails, hasAiErrorDetails } from "./ErrorBannerDetail";
import { editorStyles } from "./editorStyles";
import { FloatingAiBar } from "./FloatingAiBar";
import { FloatingLangyBar } from "./FloatingLangyBar";
import { setFilterChipLabels } from "./filterHighlight";
import { PlaceholderEditor } from "./PlaceholderEditor";
import {
  ClearButton,
  type SearchBarStatus,
  StatusBadge,
  statusBackgroundColor,
  statusBorderColor,
} from "./SearchBarIndicators";
import { SearchedAsNotice } from "./SearchedAsNotice";
import { SearchFallbackNotice } from "./SearchFallbackNotice";
import { SyntaxHelpDrawerHost } from "./SyntaxHelpDrawer";
import { searchSubmitProgress } from "./searchSubmitProgress";
import {
  TokenValuePicker,
  type TokenValuePickerAnchor,
} from "./TokenValuePicker";
import { useAskLangyFromSearch } from "./useAskLangyFromSearch";
import type { ValueResolver } from "./useFilterEditor";
import { useFloatRect } from "./useFloatRect";
import { useGlobalAiShortcut } from "./useGlobalAiShortcut";
import { useSubmitSearch } from "./useSubmitSearch";

const MAX_DYNAMIC_ITEMS = 10;

type RankedValue = { value: string; count: number; label?: string };

function rankAndSlice({
  values,
  query,
}: {
  values: readonly RankedValue[];
  query: string;
}): {
  items: string[];
  counts: Record<string, number>;
  labels?: Record<string, string>;
} | null {
  if (values.length === 0) return null;
  const q = query.toLowerCase();
  const prefix: RankedValue[] = [];
  const contains: RankedValue[] = [];
  for (const v of values) {
    if (!q) {
      prefix.push(v);
      continue;
    }
    const lower = v.value.toLowerCase();
    // Match against the id only — never the label. The user has
    // explicitly asked that names are display-only and the query
    // language stay ID-rooted, which keeps the chip and the typed
    // query in lock-step: if the user types "gpt-4o" they get a chip
    // whose underlying value is `gpt-4o`, not whichever evaluator
    // happens to be named "GPT-4o today".
    if (lower.startsWith(q)) prefix.push(v);
    else if (lower.includes(q)) contains.push(v);
  }
  const top = [...prefix, ...contains].slice(0, MAX_DYNAMIC_ITEMS);
  if (top.length === 0) return null;
  const items = top.map((v) => v.value);
  const counts: Record<string, number> = {};
  const labels: Record<string, string> = {};
  let hasLabel = false;
  for (const v of top) {
    counts[v.value] = v.count;
    if (v.label && v.label !== v.value) {
      labels[v.value] = v.label;
      hasLabel = true;
    }
  }
  return hasLabel ? { items, counts, labels } : { items, counts };
}

export const SearchBar: React.FC = () => {
  const queryText = useExplorerStore((s) => s.queryText);
  const parseError = useExplorerStore((s) => s.parseError);
  const aiError = useExplorerStore((s) => s.aiError);
  const setAiError = useExplorerStore((s) => s.setAiError);
  const dismissParseError = useExplorerStore((s) => s.dismissParseError);
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);
  const clearAll = useExplorerStore((s) => s.clearAll);
  const lastAiTranslation = useExplorerStore((s) => s.lastAiTranslation);

  // Cross-facet OR is built and edited entirely in the filter bar (the
  // QueryBreakdownChips render the full AND/OR/paren grouping), so it
  // doesn't need a warning chip. Parse errors still win.
  const status: SearchBarStatus = parseError
    ? { kind: "error", message: parseError }
    : { kind: "ok" };

  // For a user who has Langy, the ask affordance IS Langy: the button and
  // ⌘I hand the question and the view to the panel instead of the inline
  // AI composer. Everyone else keeps the composer.
  // Spec: specs/traces-v2/search.feature ("The search bar's ask
  // affordance belongs to Langy when Langy is available").
  const { langyRoutesAsk, askLangyFromSearch } = useAskLangyFromSearch();
  const askLabel = langyRoutesAsk ? "Ask Langy" : "Ask AI";
  // Which Langy surface takes the question. With the panel already open,
  // it does — the search rides over as attached context, no second
  // composer. With it closed, a Langy-styled ask bar floats over the
  // search bar so the question is typed at the top of the trace
  // explorer, next to the traces it is about; Enter hands it off and
  // opens the panel.
  const langyPanelOpen = useLangyStore((s) => s.isOpen);
  const [langyAskMode, setLangyAskMode] = useState(false);
  const openLangyAsk = useCallback(() => {
    if (useLangyStore.getState().isOpen) {
      askLangyFromSearch();
      return;
    }
    setLangyAskMode(true);
  }, [askLangyFromSearch]);
  // The floating ask bar exists because the panel is closed; if the panel
  // opens some other way (its own toggle, a home banner) the bar has lost
  // its reason and two composers would be on screen.
  useEffect(() => {
    if (langyPanelOpen) setLangyAskMode(false);
  }, [langyPanelOpen]);

  // Gate the inline Ask AI composer on having at least one model provider
  // configured. The AI mode submits requests against the user's own keys;
  // with none enabled the request would 4xx. The button stays mounted so
  // the affordance is discoverable, but click goes through a primer
  // popover pointing the user at /settings/model-providers. Langy needs
  // none of this — the panel walks the user through model setup itself —
  // so when Langy owns the affordance the primer never blocks the way in.
  const { project, organization } = useOrganizationTeamProject();
  const { hasEnabledProviders, isLoading: isLoadingProviders } =
    useModelProvidersSettings({ projectId: project?.id });
  const askAiNeedsProviderPrimer =
    !langyRoutesAsk && !isLoadingProviders && !hasEnabledProviders;
  // Both routes work on the user's real traces. In sample mode the rows
  // are hardcoded client-side fixtures with no server footprint, so an
  // AI query would error or hallucinate, and a search handed to Langy
  // would describe rows the project doesn't have. Surface the button as
  // gated with a one-line tooltip so the user knows the affordance is
  // real, just unavailable here. The ⌘I shortcut also bails in this mode
  // so we don't dump them somewhere they can't submit from.
  const isSamplePreview = usePreviewTracesActive();
  const askAiSampleDisabledReason = isSamplePreview
    ? `${askLabel} works on your real traces — not on the sample data.`
    : undefined;

  // Defer TipTap mount until the user actually focuses the search bar — the
  // ProseMirror init reflow used to dominate LCP.
  const [editorMounted, setEditorMounted] = useState(false);
  const [editorHasContent, setEditorHasContent] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [cursorAnchorX, setCursorAnchorX] = useState(0);
  const [editorFocused, setEditorFocused] = useState(false);
  // Anchor info for the click-a-chip-to-edit-value popover. Lifted to
  // SearchBar so the popover can portal into document.body and share
  // the same instance whether the click came from PlaceholderEditor or
  // the live ProseMirror editor.
  const [tokenAnchor, setTokenAnchor] = useState<TokenValuePickerAnchor | null>(
    null,
  );

  const requestEditor = useCallback(() => setEditorMounted(true), []);

  const hasContent = editorMounted ? editorHasContent : queryText.length > 0;

  // Clear runs on mousedown and preventDefaults it, so the caret stays in the
  // bar. That keeps the editor the source of truth for its own document, and
  // text the user never submitted is not in the store, so emptying the store
  // alone would leave the words on screen. The bump is the instruction.
  const [clearNonce, setClearNonce] = useState(0);
  const handleClear = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      clearAll();
      setClearNonce((n) => n + 1);
    },
    [clearAll],
  );

  const placeholderRef = useRef<HTMLDivElement>(null);
  const floatRect = useFloatRect(placeholderRef, aiMode || langyAskMode);

  // Delegate chip hover events on the search bar so both the cold-load
  // PlaceholderEditor and the live ProseMirror editor's
  // decoration-injected chips broadcast hover into the global
  // `facetHoverStore`. The sidebar listens to that store and
  // cross-highlights the matching row.
  useEffect(() => {
    // When the chip layer disappears (AI/Langy ask mode swap, unmount) no
    // DOM mouseout fires for the removed chip nodes — clear up front so a
    // mid-hover transition can't leave the sidebar latched on a chip
    // that no longer exists.
    if (aiMode || langyAskMode) {
      useFacetHoverStore.getState().clearHover();
      return;
    }
    const root = placeholderRef.current;
    if (!root) return;
    const enter = (e: Event) => {
      const target = (e.target as HTMLElement | null)?.closest(
        "[data-filter-chip-field][data-filter-chip-value]",
      ) as HTMLElement | null;
      if (!target) return;
      const field = target.dataset.filterChipField ?? "";
      const value = target.dataset.filterChipValue ?? "";
      if (!field || !value) return;
      // Highlight the matching sidebar row for this single (field,
      // value) pair.
      useFacetHoverStore.getState().setHoveredFacet({ field, value });
    };
    const leave = (e: Event) => {
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      // Don't clear if we're moving between two chips — the next chip's
      // mouseenter will overwrite and we'd otherwise flicker the
      // highlight off-then-on.
      if (related?.closest("[data-filter-chip-field]")) return;
      useFacetHoverStore.getState().clearHover();
    };
    root.addEventListener("mouseover", enter, true);
    root.addEventListener("mouseout", leave, true);
    return () => {
      root.removeEventListener("mouseover", enter, true);
      root.removeEventListener("mouseout", leave, true);
      useFacetHoverStore.getState().clearHover();
    };
  }, [aiMode, langyAskMode]);

  // ⌘I / Ctrl+I anywhere on the page fires the ask affordance: the Langy
  // handoff when Langy owns it, otherwise AI mode — gated through the
  // same provider-primer popover the button uses, since pressing the
  // shortcut when no provider is configured shouldn't dump the user into
  // a composer they can't actually submit from. The AI-mode branch fires
  // the animation by flipping the same `aiMode` state the button does,
  // so the gradient activation feels identical from key or click.
  const handleAiShortcut = useCallback(() => {
    if (isSamplePreview) return;
    if (langyRoutesAsk) {
      openLangyAsk();
      return;
    }
    if (askAiNeedsProviderPrimer) return;
    setAiMode(true);
  }, [askAiNeedsProviderPrimer, isSamplePreview, langyRoutesAsk, openLangyAsk]);
  useGlobalAiShortcut(handleAiShortcut, { enabled: !langyRoutesAsk });

  const handleAiBarClose = useCallback(() => setAiMode(false), []);

  // Enter on a sentence. The router answers with what the sentence is; a
  // `langy` answer takes the same door as the button, with the view
  // attached. A search that ran without the model that shapes it says so in
  // the strip under the bar (`SearchFallbackNotice`), which is where the
  // model settings are offered.
  // While the read is in flight the submit still goes to the server, which
  // refuses with this same popover on `instant_eval_not_enabled` — so a slow
  // flag read never hides a feature the project actually has.
  const { enabled: instantEvalsReleased, isLoading: instantEvalsFlagLoading } =
    useFeatureFlag("release_instant_evals", {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: !!project?.id && !!organization?.id,
    });
  const isInstantEvalAvailable =
    instantEvalsReleased || instantEvalsFlagLoading;
  const instantEval = useInstantEvalRoute({ isInstantEvalAvailable });
  const { onInstantEvalRoute } = instantEval;
  // The route's dialog and popover are anchored here, so a caller outside the
  // bar (a Langy action) reaches this same route rather than one of its own.
  useEffect(
    () => registerInstantEvalRoute(onInstantEvalRoute),
    [onInstantEvalRoute],
  );
  const { submitSearch, isRouting } = useSubmitSearch({
    isLangyAvailable: langyRoutesAsk,
    isInstantEvalAvailable,
    isSamplePreview,
    onLangy: askLangyFromSearch,
    onInstantEval: onInstantEvalRoute,
    onSupersede: instantEval.abandonPendingRun,
  });
  // A text handed over by another part of the page (the empty state's "Judge
  // these results") is submitted the way a typed one is.
  const submitRequest = useSearchSubmitRequestStore((s) => s.request);
  const clearSubmitRequest = useSearchSubmitRequestStore((s) => s.clear);
  useEffect(() => {
    if (!submitRequest) return;
    clearSubmitRequest();
    submitSearch(submitRequest.text);
  }, [submitRequest, clearSubmitRequest, submitSearch]);
  const submitProgress = searchSubmitProgress({
    isRouting,
    isEstimating: instantEval.isEstimating,
    isStarting: instantEval.isStarting,
  });

  // Reuse the discover payload that already powers the facets sidebar — its
  // `topValues` is exactly the autocomplete pool for `model:`, `service:`,
  // etc. No extra fetch, and the resolver is called inline by the editor's
  // refreshSuggestion so each keystroke produces one render, not two.
  const { data: facets } = useTraceFacets();
  const valueSourceByField = useMemo(() => {
    const map = new Map<
      string,
      readonly { value: string; count: number; label?: string }[]
    >();
    for (const facet of facets) {
      if (facet.kind === "categorical") {
        map.set(facet.key, facet.topValues);
      }
    }
    return map;
  }, [facets]);

  // An `eval` chip wears its run's state: pending until a run is registered
  // for it, partial once a run stopped short of its total. The mark rides on
  // the same overlay label the facet labels use, so the chip stays one chip.
  // Spec: specs/traces-v2/instant-eval-search.feature ("Stop cancels the run
  // and keeps the chip as partial", "A chip with no registered run is pending").
  const { chips: evalChips } = useInstantEvalRuns();
  const evalRuns = useInstantEvalRunStore((s) => s.runs);
  const settledEvalRuns = useInstantEvalRunStore((s) => s.settled);
  const evalChipMarks = useMemo(
    () =>
      instantEvalChipMarks({
        chips: evalChips,
        runs: evalRuns,
        settled: settledEvalRuns,
      }),
    [evalChips, evalRuns, settledEvalRuns],
  );

  // Spec: specs/traces-v2/instant-eval-search.feature ("An eval chip sweeps
  // while its run is under way").
  const instantEvalBusy = isInstantEvalBusy({
    isEstimating: instantEval.isEstimating,
    isStarting: instantEval.isStarting,
    chips: evalChips,
    runs: evalRuns,
  });

  // Publish the (field → value → label) lookup the chip overlay reads
  // from. The editor's FilterHighlight plugin watches this via a
  // module-level ref; we ping it with a LABEL_REFRESH meta so chips
  // re-render with their new overlays the moment facets land. Without
  // the meta the plugin's cached decorations would stay stale until
  // the next keystroke.
  useEffect(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const facet of facets) {
      if (facet.kind !== "categorical") continue;
      const fieldMap: Record<string, string> = {};
      for (const v of facet.topValues) {
        if (v.label && v.label !== v.value) fieldMap[v.value] = v.label;
      }
      if (Object.keys(fieldMap).length > 0) map[facet.key] = fieldMap;
    }
    for (const [field, values] of Object.entries(evalChipMarks)) {
      map[field] = { ...(map[field] ?? {}), ...values };
    }
    setFilterChipLabels(map);
  }, [facets, evalChipMarks]);
  const valueResolver = useCallback<ValueResolver>(
    (field, query) => {
      const meta = SEARCH_FIELDS[field];
      const facetField = meta?.facetField;
      if (!facetField) return null;
      const source = valueSourceByField.get(facetField);
      if (!source) return null;
      return rankAndSlice({ values: source, query: query.replace(/\*+$/, "") });
    },
    [valueSourceByField],
  );

  return (
    <Box
      ref={placeholderRef}
      position="relative"
      width="full"
      flexShrink={0}
      zIndex={20}
      minHeight="38px"
      data-spotlight="search-bar"
    >
      <SyntaxHelpDrawerHost />
      <AnimatePresence>
        {langyAskMode && (
          // A crash inside the Langy ask surface must never cost the user
          // their search bar. On error the surface folds away (the boundary
          // logs it) and the structured bar comes straight back; the next
          // click mounts a fresh boundary, so nothing stays stuck.
          <IsolatedErrorBoundary
            key="langy-ask-bar"
            scope="Langy couldn't open here"
            onError={() => setLangyAskMode(false)}
          >
            <FloatingLangyBar
              rect={floatRect}
              onClose={() => setLangyAskMode(false)}
              onAsk={askLangyFromSearch}
            />
          </IsolatedErrorBoundary>
        )}
        {aiMode && (
          <FloatingAiBar
            key="ai-bar"
            rect={floatRect}
            onClose={handleAiBarClose}
            // Re-show the last natural-language prompt when the applied
            // query is still the one it produced; otherwise seed the
            // composer with the query itself.
            initialPrompt={
              lastAiTranslation &&
              lastAiTranslation.projectId === project?.id &&
              lastAiTranslation.query === queryText
                ? lastAiTranslation.prompt
                : queryText
            }
            autoSubmit={false}
          />
        )}
      </AnimatePresence>
      {!aiMode && !langyAskMode && (
        <>
          <Flex
            align="center"
            width="full"
            gap={2}
            paddingX={3}
            paddingY={1.5}
            borderBottomWidth={status.kind === "error" ? "0" : "1px"}
            borderColor={statusBorderColor(status)}
            minHeight="38px"
            bg={statusBackgroundColor(status)}
            transition="background 120ms ease, border-color 120ms ease"
            position="relative"
            zIndex={1}
          >
            <AskAiButton
              quiet={instantEvalBusy}
              label={askLabel}
              ariaLabel={langyRoutesAsk ? "Ask Langy" : undefined}
              tooltip={
                langyRoutesAsk ? "Ask Langy about these traces" : undefined
              }
              onClick={langyRoutesAsk ? openLangyAsk : () => setAiMode(true)}
              needsProviderPrimer={askAiNeedsProviderPrimer}
              disabledReason={askAiSampleDisabledReason}
            />
            {/* The standalone search glyph is only an at-rest hint — the
                placeholder already says what the field is. Once focused or
                non-empty it reads as clutter wedged between the ask button
                and the text, so it drops out and the editor sits directly
                beside the ask button. */}
            {!editorFocused && !hasContent && (
              <Icon color="fg.subtle" flexShrink={0} boxSize="14px">
                <Search />
              </Icon>
            )}

            <Box
              flex={1}
              minWidth={0}
              position="relative"
              css={editorStyles}
              data-instant-eval-busy={instantEvalBusy ? "" : undefined}
            >
              {editorMounted ? (
                <ActiveSearchEditor
                  queryText={queryText}
                  applyQueryText={applyQueryText}
                  submitQueryText={submitSearch}
                  autoFocus
                  onHasContentChange={setEditorHasContent}
                  valueResolver={valueResolver}
                  onTokenClick={setTokenAnchor}
                  onSuggestionOpenChange={setSuggestionOpen}
                  onCursorAnchorChange={setCursorAnchorX}
                  onFocusChange={setEditorFocused}
                  clearNonce={clearNonce}
                />
              ) : (
                <PlaceholderEditor
                  queryText={queryText}
                  onActivate={requestEditor}
                  onApplyQueryText={applyQueryText}
                  onTokenClick={setTokenAnchor}
                />
              )}
              {hasContent && editorFocused && !suggestionOpen && (
                <SearchSubmitHint anchorX={cursorAnchorX} />
              )}
            </Box>

            {/* Only render the badge for non-error statuses — parse errors
                get the full inline banner below, which is far more visible
                and positioned right under the input where the user is
                looking. Showing the badge *and* the banner would be
                redundant and noisy. */}
            {status.kind !== "error" && <StatusBadge status={status} />}
            {submitProgress && (
              <HStack
                gap={1.5}
                flexShrink={0}
                color="fg.subtle"
                role="status"
                data-testid="search-submit-progress"
              >
                <Spinner size="xs" />
                <Text textStyle="xs">{submitProgress}</Text>
              </HStack>
            )}
            {hasContent ? (
              <ClearButton onClear={handleClear} />
            ) : (
              <Kbd>{"/"}</Kbd>
            )}
            <TokenValuePicker
              anchor={tokenAnchor}
              onClose={() => setTokenAnchor(null)}
            />
          </Flex>
          {/* Anchored to a point at the bar's bottom-left rather than to the
              bar itself: an anchor nested around the editor would remount the
              popover on every keystroke. */}
          <InstantEvalRefusalPopover
            refusal={instantEval.refusal}
            onClose={instantEval.dismissRefusal}
          >
            <Box
              position="absolute"
              left={3}
              bottom={0}
              width="1px"
              height="1px"
              aria-hidden="true"
            />
          </InstantEvalRefusalPopover>
          <InstantEvalConfirmDialog
            confirmation={instantEval.confirmation}
            isStarting={instantEval.isStarting}
            onRun={instantEval.confirmRun}
            onSearchWords={instantEval.searchWordsInstead}
            onClose={instantEval.searchWordsInstead}
          />
          <SearchedAsNotice />
          <SearchFallbackNotice />
          {/* Unified error banner — handles both parse errors and AI errors.
              AI error takes priority when both are present (AI mode is the
              active flow). Rendered outside the Flex row so it spans the
              full bar width without fighting the row's gap/padding. */}
          <UnifiedErrorBanner
            parseError={parseError}
            aiError={aiError}
            onDismissAiError={() => setAiError(null)}
            onDismissParseError={dismissParseError}
          />
        </>
      )}
    </Box>
  );
};

/** Whether an `eval` chip's run is being estimated, started or judged. */
export function isInstantEvalBusy({
  isEstimating,
  isStarting,
  chips,
  runs,
}: {
  isEstimating: boolean;
  isStarting: boolean;
  chips: readonly { runId: string | null }[];
  runs: Readonly<Record<string, { status: InstantEvalExplorerStatus }>>;
}): boolean {
  if (isEstimating || isStarting) return true;
  return chips.some((chip) => {
    const run = chip.runId === null ? undefined : runs[chip.runId];
    return run !== undefined && isInstantEvalRunActive(run.status);
  });
}

/** The overlay labels of the marked `eval` chips: field, then question. */
export function instantEvalChipMarks({
  chips,
  runs,
  settled,
}: {
  chips: readonly { field: string; question: string; runId: string | null }[];
  runs: Readonly<
    Record<
      string,
      {
        status: InstantEvalExplorerStatus;
        progress: number;
        total: number | null;
      }
    >
  >;
  settled: Readonly<Record<string, true>>;
}): Record<string, Record<string, string>> {
  const marks: Record<string, Record<string, string>> = {};
  for (const chip of chips) {
    const mark = instantEvalChipMark({
      run: chip.runId === null ? undefined : runs[chip.runId],
      hasRun: chip.runId !== null,
      isSettled: chip.runId !== null && settled[chip.runId] === true,
    });
    if (!mark) continue;
    const label = instantEvalChipLabel({ question: chip.question, mark });
    marks[chip.field] = { ...marks[chip.field], [chip.question]: label };
  }
  return marks;
}

/** A marked chip reads like an unmarked one: the question in its quotes. */
export function instantEvalChipLabel({
  question,
  mark,
}: {
  question: string;
  mark: string;
}): string {
  return `"${question}" ${mark}`;
}

/**
 * What an `eval` chip wears beside its question: "(pending)" until a run is
 * registered for it, "(partial)" once the run ended short of its total, and
 * nothing while it judges or after it finished whole.
 */
export function instantEvalChipMark({
  run,
  hasRun,
  isSettled = true,
}: {
  run:
    | {
        status: InstantEvalExplorerStatus;
        progress: number;
        total: number | null;
      }
    | undefined;
  hasRun: boolean;
  /** False while an ended run's counters may still move. */
  isSettled?: boolean;
}): string | null {
  if (!hasRun) return "(pending)";
  if (!run) return null;
  if (isInstantEvalRunActive(run.status) || !isSettled) return null;
  const ended = run.status === "cancelled" || run.status === "failed";
  if (ended && (run.total === null || run.progress < run.total)) {
    const judged = run.progress.toLocaleString();
    const total = run.total === null ? "?" : run.total.toLocaleString();
    return `(partial: ${judged} of ${total} judged)`;
  }
  return null;
}

/**
 * Unified error banner rendered flush below the search bar.
 * Shows AI errors (with expand/collapse for structured details) or parse
 * errors (plain message only). AI error takes priority when both are set.
 * Each error type has its own dismiss button.
 */
function aiErrorMessage(error: AiActionError): string {
  const { title, description } = explainAnyError(error.cause);
  return description ? `${title}. ${description}` : title;
}

const UnifiedErrorBanner: React.FC<{
  parseError: string | null;
  aiError: AiActionError | null;
  onDismissAiError: () => void;
  onDismissParseError: () => void;
}> = ({ parseError, aiError, onDismissAiError, onDismissParseError }) => {
  const [expanded, setExpanded] = useState(false);

  // When the active error changes, collapse so stale expand state doesn't
  // show a mismatched detail section.
  useEffect(() => {
    setExpanded(false);
  }, [aiError, parseError]);

  // AI error wins when both are present.
  const activeAiError = aiError;
  const activeParseError = !aiError ? parseError : null;

  const showBanner = Boolean(activeAiError ?? activeParseError);
  const canExpand = Boolean(activeAiError && hasAiErrorDetails(activeAiError));
  // An AI failure's words come from the code-keyed registry via
  // `explainAnyError`, never from a sentence the server or the provider wrote.
  // A parse error is our own local copy and is rendered as-is.
  const message = activeAiError
    ? aiErrorMessage(activeAiError)
    : activeParseError;
  const handleDismiss = activeAiError ? onDismissAiError : onDismissParseError;

  return (
    <AnimatePresence>
      {showBanner && message && (
        <motion.div
          key="error-banner"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <VStack
            gap={0}
            // Solid red.subtle so the banner stays clearly visible in light
            // mode; the input row above uses the same fill on error (see
            // statusBackgroundColor) so the two read as one continuous
            // error surface with no brightness-step "top border" seam.
            bg="red.subtle"
            borderBottomWidth="1px"
            borderColor="red.muted"
            align="stretch"
          >
            <HStack gap={2} paddingX={3} paddingY={1.5} align="center">
              <Icon color="red.fg" boxSize="13px" flexShrink={0}>
                <AlertCircle />
              </Icon>
              <Text textStyle="xs" color="red.fg" fontWeight="500" flex={1}>
                {message}
              </Text>
              {canExpand && (
                <IconButton
                  aria-label={
                    expanded ? "Collapse error details" : "Expand error details"
                  }
                  size="2xs"
                  variant="ghost"
                  color="red.fg"
                  onClick={() => setExpanded((e) => !e)}
                >
                  {expanded ? (
                    <ChevronUp size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </IconButton>
              )}
              <IconButton
                aria-label="Dismiss error"
                size="2xs"
                variant="ghost"
                color="red.fg"
                onClick={handleDismiss}
              >
                <X size={12} />
              </IconButton>
            </HStack>
            {expanded && activeAiError && canExpand && (
              <Box paddingX={3} paddingBottom={2}>
                <AiErrorDetails error={activeAiError} />
              </Box>
            )}
          </VStack>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/** What the inline hint says: Enter is the one way to search. */
export const SEARCH_SUBMIT_HINT = "⏎ Enter to search";

/**
 * Plain one-liner hint that floats just after the typed content.
 * Pure UTF-8 text — no Kbd chips, no clickable fragments. The whole
 * thing reads as a single faint hint and never competes with the
 * input for attention.
 */
const SearchSubmitHint: React.FC<{ anchorX: number }> = ({ anchorX }) => (
  <chakra.span
    position="absolute"
    // Bigger gap (24px) so the hint doesn't crowd the last typed glyph.
    left={`${anchorX + 24}px`}
    // Pixel-nudge up (~1px from geometric center) — the hint text and
    // the editor text use different font stacks, and Chakra's exact
    // 50% transform leaves the hint baseline sitting visibly below
    // the editor's typing line on light mode.
    top="calc(50% - 1px)"
    transform="translateY(-50%)"
    color="fg.subtle"
    fontSize="xs"
    fontWeight="normal"
    whiteSpace="nowrap"
    overflow="hidden"
    textOverflow="ellipsis"
    pointerEvents="none"
    userSelect="none"
  >
    {SEARCH_SUBMIT_HINT}
  </chakra.span>
);
