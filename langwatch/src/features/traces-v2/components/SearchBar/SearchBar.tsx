import { Box, Flex, Icon } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { AnimatePresence } from "motion/react";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { SEARCH_FIELDS } from "~/server/app-layer/traces/query-language/metadata";
import { hasCrossFacetOR } from "~/server/app-layer/traces/query-language/queries";
import { useTraceFacets } from "../../hooks/useTraceFacets";
import { useFilterStore } from "../../stores/filterStore";
import { AskAiButton } from "../ai/AskAiButton";
import { ActiveSearchEditor } from "./ActiveSearchEditor";
import { editorStyles } from "./editorStyles";
import { FloatingAiBar } from "./FloatingAiBar";
import { PlaceholderEditor } from "./PlaceholderEditor";
import {
  ClearButton,
  CrossFacetWarning,
  ParseErrorIndicator,
} from "./SearchBarIndicators";
import { SyntaxHelpDrawerHost } from "./SyntaxHelpDrawer";
import type { ValueResolver } from "./useFilterEditor";
import { useFloatRect } from "./useFloatRect";

const MAX_DYNAMIC_ITEMS = 10;

function rankAndSlice(
  values: readonly { value: string; count: number }[],
  query: string,
): { items: string[]; counts: Record<string, number> } | null {
  if (values.length === 0) return null;
  const q = query.toLowerCase();
  const prefix: { value: string; count: number }[] = [];
  const contains: { value: string; count: number }[] = [];
  for (const v of values) {
    if (!q) {
      prefix.push(v);
      continue;
    }
    const lower = v.value.toLowerCase();
    if (lower.startsWith(q)) prefix.push(v);
    else if (lower.includes(q)) contains.push(v);
  }
  const top = [...prefix, ...contains].slice(0, MAX_DYNAMIC_ITEMS);
  if (top.length === 0) return null;
  const items = top.map((v) => v.value);
  const counts: Record<string, number> = {};
  for (const v of top) counts[v.value] = v.count;
  return { items, counts };
}

export const SearchBar: React.FC = () => {
  const queryText = useFilterStore((s) => s.queryText);
  const parseError = useFilterStore((s) => s.parseError);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const clearAll = useFilterStore((s) => s.clearAll);
  const showCrossFacetWarning = useFilterStore((s) => hasCrossFacetOR(s.ast));

  // Defer TipTap mount until the user actually focuses the search bar — the
  // ProseMirror init reflow used to dominate LCP.
  const [editorMounted, setEditorMounted] = useState(false);
  const [editorHasContent, setEditorHasContent] = useState(false);
  const [aiMode, setAiMode] = useState(false);

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

  // Reuse the discover payload that already powers the facets sidebar — its
  // `topValues` is exactly the autocomplete pool for `model:`, `service:`,
  // etc. No extra fetch, and the resolver is called inline by the editor's
  // refreshSuggestion so each keystroke produces one render, not two.
  const { data: facets } = useTraceFacets();
  const valueSourceByField = useMemo(() => {
    const map = new Map<string, readonly { value: string; count: number }[]>();
    for (const facet of facets) {
      if (facet.kind === "categorical") {
        map.set(facet.key, facet.topValues);
      }
    }
    return map;
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
            onClose={() => setAiMode(false)}
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
          borderColor={parseError ? "red.fg" : "border"}
          minHeight="38px"
          bg="bg.surface"
          position="relative"
          zIndex={1}
        >
          <AskAiButton onClick={() => setAiMode(true)} />
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
              />
            ) : (
              <PlaceholderEditor
                queryText={queryText}
                onActivate={requestEditor}
              />
            )}
          </Box>

          {parseError && <ParseErrorIndicator message={parseError} />}
          {showCrossFacetWarning && <CrossFacetWarning />}
          {hasContent ? (
            <ClearButton onClear={handleClear} />
          ) : (
            <Kbd>{"/"}</Kbd>
          )}
        </Flex>
      )}
    </Box>
  );
};
