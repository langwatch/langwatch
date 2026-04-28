import { Box, Button, Flex, HStack, IconButton, Icon, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, BookOpen, Search, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Popover } from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";
import { useFilterStore } from "../../stores/filterStore";
import { useUIStore } from "../../stores/uiStore";
import { hasCrossFacetOR } from "../../utils/queryParser";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { MeshGradient } from "@paper-design/shaders-react";
import { ActiveSearchEditor } from "./ActiveSearchEditor";
import { AiQueryComposer } from "./AiQueryComposer";
import { AiShaderBackdrop } from "./AiShaderBackdrop";
import { aiBrandPalette } from "../ai/aiBrandPalette";
import { AskAiButton } from "../ai/AskAiButton";
import { editorStyles } from "./editorStyles";
import { PlaceholderEditor } from "./PlaceholderEditor";
import { SyntaxHelpDrawerHost } from "./SyntaxHelpDrawer";

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

interface FloatRect {
  top: number;
  left: number;
  width: number;
}

const useFloatRect = (
  ref: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
): FloatRect | null => {
  const [rect, setRect] = useState<FloatRect | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setRect(null);
      return;
    }
    const update = () => {
      const node = ref.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [enabled, ref]);

  return rect;
};

interface FloatingAiBarProps {
  rect: FloatRect | null;
  onClose: () => void;
}

const FloatingAiBar: React.FC<FloatingAiBarProps> = ({ rect, onClose }) => {
  const [pending, setPending] = useState(false);
  if (typeof document === "undefined" || !rect) return null;
  return createPortal(
    <motion.div
      style={{
        position: "fixed",
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        zIndex: 30,
        minHeight: "38px",
        borderTopLeftRadius: "var(--chakra-radii-lg)",
        boxShadow:
          "0 4px 12px rgba(168,85,247,0.12), 0 2px 6px rgba(0,0,0,0.06)",
      }}
      initial={{ opacity: 0, filter: "blur(10px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, filter: "blur(10px)" }}
      transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
    >
      <AiShaderBackdrop active={pending} />
      <Box
        position="absolute"
        top="1.5px"
        left="1.5px"
        right="1.5px"
        bottom="1.5px"
        bg="bg.surface/92"
        borderTopLeftRadius="lg"
        borderTopRightRadius={0}
        borderBottomLeftRadius={0}
        borderBottomRightRadius={0}
        display="flex"
        alignItems="center"
        paddingX={3}
        paddingY={1.5}
        gap={2}
        zIndex={1}
      >
        <AiQueryComposer onClose={onClose} onPendingChange={setPending} />
      </Box>
    </motion.div>,
    document.body,
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

const ParseErrorIndicator: React.FC<{ message: string }> = ({ message }) => {
  const setSyntaxHelpOpen = useUIStore((s) => s.setSyntaxHelpOpen);
  return (
    <Popover.Root positioning={{ placement: "bottom-end" }}>
      <Popover.Trigger asChild>
        <Button
          size="2xs"
          variant="ghost"
          flexShrink={0}
          colorPalette="red"
          color="red.fg"
          aria-label="View syntax error"
        >
          <AlertTriangle size={12} />
          <Text textStyle="xs" fontWeight="600">
            Syntax
          </Text>
        </Button>
      </Popover.Trigger>
      <Popover.Content maxWidth="320px">
        <Popover.Arrow />
        <Popover.Body>
          <HStack gap={2} align="start" marginBottom={2}>
            <Box
              boxSize="20px"
              borderRadius="sm"
              bg="red.subtle"
              color="red.fg"
              display="flex"
              alignItems="center"
              justifyContent="center"
              flexShrink={0}
            >
              <AlertTriangle size={11} />
            </Box>
            <VStack align="start" gap={0.5}>
              <Text textStyle="xs" fontWeight="700" color="fg" textTransform="uppercase" letterSpacing="0.08em">
                Invalid query
              </Text>
              <Text textStyle="sm" color="fg">
                {message}
              </Text>
            </VStack>
          </HStack>
          <Button
            size="xs"
            variant="surface"
            colorPalette="blue"
            width="full"
            onClick={() => setSyntaxHelpOpen(true)}
          >
            <BookOpen size={12} />
            Open syntax help
          </Button>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
};
