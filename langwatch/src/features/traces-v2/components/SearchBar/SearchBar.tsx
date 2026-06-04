import { Box, chakra, Flex, Icon } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { AnimatePresence } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { SEARCH_FIELDS } from "~/server/app-layer/traces/query-language/metadata";
import { useTraceFacets } from "../../hooks/useTraceFacets";
import { analyzeOrGroups } from "~/server/app-layer/traces/query-language/queries";
import { useFacetHoverStore } from "../../stores/facetHoverStore";
import { useFilterStore } from "../../stores/filterStore";
import { AskAiButton } from "../ai/AskAiButton";
import { ActiveSearchEditor } from "./ActiveSearchEditor";
import { editorStyles } from "./editorStyles";
import { setFilterChipLabels } from "./filterHighlight";
import { FloatingAiBar } from "./FloatingAiBar";
import { PlaceholderEditor } from "./PlaceholderEditor";
import {
  ClearButton,
  type SearchBarStatus,
  StatusBadge,
  statusBackgroundColor,
  statusBorderColor,
} from "./SearchBarIndicators";
import { SearchTipsPopover } from "./SearchTipsPopover";
import { SyntaxHelpDrawerHost } from "./SyntaxHelpDrawer";
import {
  TokenValuePicker,
  type TokenValuePickerAnchor,
} from "./TokenValuePicker";
import type { ValueResolver } from "./useFilterEditor";
import { useFloatRect } from "./useFloatRect";
import { useGlobalAiShortcut } from "./useGlobalAiShortcut";

const MAX_DYNAMIC_ITEMS = 10;

type RankedValue = { value: string; count: number; label?: string };

function rankAndSlice(
  values: readonly RankedValue[],
  query: string,
): {
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
  const queryText = useFilterStore((s) => s.queryText);
  const parseError = useFilterStore((s) => s.parseError);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const clearAll = useFilterStore((s) => s.clearAll);
  const lastAiTranslation = useFilterStore((s) => s.lastAiTranslation);

  // Cross-facet OR no longer triggers a warning chip: the sidebar now
  // marks OR-grouped facets with a coloured "OR" pill + rail (see
  // SidebarSection.orGroupId), so the situation reads honestly without
  // a banner. Parse errors still win.
  const status: SearchBarStatus = parseError
    ? { kind: "error", message: parseError }
    : { kind: "ok" };

  // Gate Ask AI on having at least one model provider configured. The
  // AI mode submits requests against the user's own keys; with none
  // enabled the request would 4xx. The button stays mounted so the
  // affordance is discoverable, but click goes through a primer popover
  // pointing the user at /settings/model-providers.
  const { project } = useOrganizationTeamProject();
  const { hasEnabledProviders, isLoading: isLoadingProviders } =
    useModelProvidersSettings({ projectId: project?.id });
  const askAiNeedsProviderPrimer =
    !isLoadingProviders && !hasEnabledProviders;

  // Defer TipTap mount until the user actually focuses the search bar — the
  // ProseMirror init reflow used to dominate LCP.
  const [editorMounted, setEditorMounted] = useState(false);
  const [editorHasContent, setEditorHasContent] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [cursorAnchorX, setCursorAnchorX] = useState(0);
  const [editorFocused, setEditorFocused] = useState(false);
  // When the user fires ⌘+⏎ on a typed query, we punt the text into AI
  // mode AND ask the composer to submit immediately. Tracked separately
  // from `aiMode` because the same flag would otherwise re-fire on every
  // subsequent AI-mode entry (e.g. clicking the Ask AI button to start
  // fresh would auto-submit the now-applied filter as a prompt).
  const [aiAutoSubmitSeed, setAiAutoSubmitSeed] = useState<string | null>(null);
  // Anchor info for the click-a-chip-to-edit-value popover. Lifted to
  // SearchBar so the popover can portal into document.body and share
  // the same instance whether the click came from PlaceholderEditor or
  // the live ProseMirror editor.
  const [tokenAnchor, setTokenAnchor] =
    useState<TokenValuePickerAnchor | null>(null);

  const requestEditor = useCallback(() => setEditorMounted(true), []);

  const hasContent = editorMounted ? editorHasContent : queryText.length > 0;

  const handleClear = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      clearAll();
      // The active editor's queryText effect will sync the empty state back
      // into the ProseMirror document on next render.
    },
    [clearAll],
  );

  const placeholderRef = useRef<HTMLDivElement>(null);
  const floatRect = useFloatRect(placeholderRef, aiMode);

  // Delegate chip hover events on the search bar so both the cold-load
  // PlaceholderEditor and the live ProseMirror editor's
  // decoration-injected chips broadcast hover into the global
  // `facetHoverStore`. The sidebar listens to that store and
  // cross-highlights the matching row + any OR-group peers.
  useEffect(() => {
    // When the chip layer disappears (AI mode swap, unmount) no DOM
    // mouseout fires for the removed chip nodes — clear up front so a
    // mid-hover transition can't leave the sidebar latched on a chip
    // that no longer exists.
    if (aiMode) {
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
      // Only broadcast the whole OR group when this exact (field,
      // value) is one of its members. Sharing a field with a group
      // member doesn't count — `origin:simulation` should not drag
      // `origin:evaluation` and `origin:application` along just
      // because they happen to be grouped under the same field.
      const ast = useFilterStore.getState().ast;
      const orAnalysis = analyzeOrGroups(ast);
      const groupId = orAnalysis.memberToGroupId.get(`${field}|${value}`);
      const group = groupId
        ? orAnalysis.groups.find((g) => g.id === groupId)
        : null;
      if (group) {
        useFacetHoverStore.getState().setHoveredGroup(group);
      } else {
        useFacetHoverStore.getState().setHoveredFacet({ field, value });
      }
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
  }, [aiMode]);

  // ⌘I / Ctrl+I anywhere on the page enters AI mode. Gated through the
  // same provider-primer popover the button uses — pressing the shortcut
  // when no provider is configured shouldn't dump the user into a
  // composer they can't actually submit from. The shortcut fires the
  // animation by flipping the same `aiMode` state the button does, so
  // the gradient activation feels identical from key or click.
  const handleAiShortcut = useCallback(() => {
    if (askAiNeedsProviderPrimer) return;
    setAiMode(true);
  }, [askAiNeedsProviderPrimer]);
  useGlobalAiShortcut(handleAiShortcut);

  // ⌘+⏎ / Ctrl+⏎ from inside the editor: punt the typed text into AI
  // mode and auto-submit it. Lets the operator triage "is this filter
  // syntax or free text I want the AI to interpret?" without taking
  // their hands off the keyboard.
  const handleEditorAiShortcut = useCallback(
    (currentText: string) => {
      if (askAiNeedsProviderPrimer) return;
      const trimmed = currentText.trim();
      // Empty input still opens the composer (parity with the button),
      // it just doesn't auto-submit a blank prompt.
      setAiAutoSubmitSeed(trimmed.length > 0 ? trimmed : null);
      setAiMode(true);
    },
    [askAiNeedsProviderPrimer],
  );

  const handleAiBarClose = useCallback(() => {
    setAiMode(false);
    setAiAutoSubmitSeed(null);
  }, []);

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
    setFilterChipLabels(map);
  }, [facets]);
  const valueResolver = useCallback<ValueResolver>(
    (field, query) => {
      const meta = SEARCH_FIELDS[field];
      const facetField = meta?.facetField;
      if (!facetField) return null;
      const source = valueSourceByField.get(facetField);
      if (!source) return null;
      return rankAndSlice(source, query.replace(/\*+$/, ""));
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
    >
      <SyntaxHelpDrawerHost />
      <AnimatePresence>
        {aiMode && (
          <FloatingAiBar
            key="ai-bar"
            rect={floatRect}
            onClose={handleAiBarClose}
            // If the ⌘+⏎ shortcut seeded a specific prompt, that wins
            // outright (and the composer auto-submits below). Otherwise
            // fall through to the same "re-show last natural-language
            // prompt vs current query" logic the Ask AI button uses.
            initialPrompt={
              aiAutoSubmitSeed !== null
                ? aiAutoSubmitSeed
                : lastAiTranslation &&
                    lastAiTranslation.projectId === project?.id &&
                    lastAiTranslation.query === queryText
                  ? lastAiTranslation.prompt
                  : queryText
            }
            autoSubmit={aiAutoSubmitSeed !== null}
          />
        )}
      </AnimatePresence>
      {!aiMode && (
        <Flex
          align="center"
          width="full"
          gap={2}
          paddingX={3}
          paddingY={1.5}
          borderBottomWidth="1px"
          borderColor={statusBorderColor(status)}
          minHeight="38px"
          bg={statusBackgroundColor(status)}
          transition="background 120ms ease, border-color 120ms ease"
          position="relative"
          zIndex={1}
        >
          <AskAiButton
            onClick={() => setAiMode(true)}
            needsProviderPrimer={askAiNeedsProviderPrimer}
          />
          <Icon color="fg.subtle" flexShrink={0} boxSize="14px">
            <Search />
          </Icon>

          <Box flex={1} minWidth={0} position="relative" css={editorStyles}>
            {editorMounted ? (
              <ActiveSearchEditor
                queryText={queryText}
                applyQueryText={applyQueryText}
                autoFocus
                onHasContentChange={setEditorHasContent}
                valueResolver={valueResolver}
                onTokenClick={setTokenAnchor}
                onAiShortcut={handleEditorAiShortcut}
                onSuggestionOpenChange={setSuggestionOpen}
                onCursorAnchorChange={setCursorAnchorX}
                onFocusChange={setEditorFocused}
              />
            ) : (
              <PlaceholderEditor
                queryText={queryText}
                onActivate={requestEditor}
                onApplyQueryText={applyQueryText}
                onTokenClick={setTokenAnchor}
              />
            )}
            {hasContent &&
              editorFocused &&
              !suggestionOpen &&
              !askAiNeedsProviderPrimer && (
                <SearchSubmitHint anchorX={cursorAnchorX} />
              )}
          </Box>

          <StatusBadge status={status} />
          <SearchTipsPopover />
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
      )}
    </Box>
  );
};

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_KEY_SYMBOL = IS_MAC ? "⌘" : "Ctrl";

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
    {`Press ${MOD_KEY_SYMBOL} + Enter to Ask AI`}
  </chakra.span>
);
