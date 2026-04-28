import { Box, Button, Flex, Icon, Text } from "@chakra-ui/react";
import { AlertTriangle, Search, X } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { useFilterStore } from "../../stores/filterStore";
import { hasCrossFacetOR } from "../../utils/queryParser";
import { ActiveSearchEditor } from "./ActiveSearchEditor";
import { editorStyles } from "./editorStyles";
import { PlaceholderEditor } from "./PlaceholderEditor";

export const SearchBar: React.FC = () => {
  const queryText = useFilterStore((s) => s.queryText);
  const parseError = useFilterStore((s) => s.parseError);
  const ast = useFilterStore((s) => s.ast);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const clearAll = useFilterStore((s) => s.clearAll);
  const showCrossFacetWarning = useMemo(() => hasCrossFacetOR(ast), [ast]);

  // Defer TipTap mount until the user actually focuses the search bar — the
  // ProseMirror init reflow used to dominate LCP.
  const [editorMounted, setEditorMounted] = useState(false);
  const [editorHasContent, setEditorHasContent] = useState(false);

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

  return (
    <Flex
      align="center"
      width="full"
      gap={2}
      paddingX={3}
      paddingY={1.5}
      borderBottomWidth="1px"
      borderColor={parseError ? "red.fg" : "border"}
      flexShrink={0}
      minHeight="38px"
      bg="bg.surface"
      position="relative"
    >
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
          />
        ) : (
          <PlaceholderEditor queryText={queryText} onActivate={requestEditor} />
        )}
      </Box>

      {showCrossFacetWarning && <CrossFacetWarning />}
      {hasContent ? (
        <ClearButton onClear={handleClear} />
      ) : (
        <Kbd>{"/"}</Kbd>
      )}
      {parseError && <ParseErrorBanner message={parseError} />}
    </Flex>
  );
};

const CrossFacetWarning: React.FC = () => (
  <Flex
    align="center"
    gap={1}
    flexShrink={0}
    title="Query uses cross-facet OR — sidebar may not fully reflect the query."
  >
    <Icon color="yellow.400" boxSize="12px">
      <AlertTriangle />
    </Icon>
  </Flex>
);

const ClearButton: React.FC<{ onClear: (event: React.MouseEvent) => void }> = ({
  onClear,
}) => (
  <Button
    size="2xs"
    variant="ghost"
    flexShrink={0}
    fontWeight="normal"
    color="fg.subtle"
    onMouseDown={onClear}
  >
    Clear
    <X size={12} />
  </Button>
);

const ParseErrorBanner: React.FC<{ message: string }> = ({ message }) => (
  <Box
    position="absolute"
    top="100%"
    left={0}
    right={0}
    paddingX={3}
    paddingY={1}
    bg="red.500/10"
    borderBottomWidth="1px"
    borderColor="red.500/30"
    zIndex={10}
  >
    <Text textStyle="xs" color="red.fg">
      {message}
    </Text>
  </Box>
);
