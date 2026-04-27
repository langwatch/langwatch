import { Box, Button, Flex, Icon, Text, VStack } from "@chakra-ui/react";
import Document from "@tiptap/extension-document";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import { Text as TiptapText } from "@tiptap/extension-text";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { AlertTriangle, Search, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasCrossFacetOR, useFilterStore } from "../../stores/filterStore";
import { FilterHighlight } from "./filterHighlight";
import { getSuggestionState, type SuggestionState } from "./getSuggestionState";
import { handleKey, type KeyAction } from "./handleKey";
import { getSuggestionItems } from "./suggestionItems";

/**
 * The TipTap doc wraps the text in a paragraph node, so cursor positions in
 * `editor.state.selection` are 1-based. Subtract 1 to map back to a string
 * offset in `editor.getText()`, which is what `getSuggestionState` expects.
 */
const PARAGRAPH_OFFSET = 1;

interface SuggestionUIState {
  state: SuggestionState;
  items: string[];
  selectedIndex: number;
}

const CLOSED_SUGGESTION: SuggestionUIState = {
  state: { open: false },
  items: [],
  selectedIndex: 0,
};

function readContext(editor: Editor): {
  text: string;
  cursorPos: number;
  state: SuggestionState;
} {
  const text = editor.getText();
  const cursorPos = editor.state.selection.from - PARAGRAPH_OFFSET;
  return { text, cursorPos, state: getSuggestionState(text, cursorPos) };
}

function buildSuggestionUI(
  state: SuggestionState,
  previousSelected: number,
): SuggestionUIState {
  if (!state.open) return CLOSED_SUGGESTION;
  const items = getSuggestionItems(state);
  if (items.length === 0) return { state, items, selectedIndex: 0 };
  const selectedIndex = Math.min(previousSelected, items.length - 1);
  return { state, items, selectedIndex };
}

function applyAcceptToEditor(editor: Editor, action: KeyAction): void {
  if (action.kind !== "accept") return;
  editor
    .chain()
    .focus()
    .setTextSelection({
      from: action.tokenStart + PARAGRAPH_OFFSET,
      to: action.tokenEnd + PARAGRAPH_OFFSET,
    })
    .insertContent(action.replacement)
    .run();
}

export const SearchBar: React.FC = () => {
  const queryText = useFilterStore((s) => s.queryText);
  const parseError = useFilterStore((s) => s.parseError);
  const ast = useFilterStore((s) => s.ast);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const clearAll = useFilterStore((s) => s.clearAll);
  const showCrossFacetWarning = useMemo(() => hasCrossFacetOR(ast), [ast]);

  const [hasContent, setHasContent] = useState(queryText.length > 0);
  const [suggestion, setSuggestion] =
    useState<SuggestionUIState>(CLOSED_SUGGESTION);
  /** When true, the user explicitly closed the dropdown via Escape; suppress until next state change. */
  const [dropdownDismissed, setDropdownDismissed] = useState(false);

  const isProgrammaticRef = useRef(false);
  const applyRef = useRef(applyQueryText);
  const suggestionRef = useRef(suggestion);
  const dismissedRef = useRef(dropdownDismissed);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    applyRef.current = applyQueryText;
  }, [applyQueryText]);

  useEffect(() => {
    suggestionRef.current = suggestion;
  }, [suggestion]);

  useEffect(() => {
    dismissedRef.current = dropdownDismissed;
  }, [dropdownDismissed]);

  const recomputeFromEditor = useCallback((editor: Editor) => {
    const { state } = readContext(editor);
    if (dismissedRef.current && state.open) {
      // User explicitly dismissed; keep closed until the cursor leaves and re-enters a token.
      setSuggestion(CLOSED_SUGGESTION);
      return;
    }
    if (!state.open && dismissedRef.current) {
      // Cursor moved out — reset the dismissed flag so the next entry re-opens.
      setDropdownDismissed(false);
    }
    setSuggestion((prev) => buildSuggestionUI(state, prev.selectedIndex));
  }, []);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      TiptapText,
      History,
      Placeholder.configure({
        placeholder: "Filter traces… type a field name or free text",
      }),
      FilterHighlight,
    ],
    content: queryText
      ? {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: queryText }],
            },
          ],
        }
      : undefined,
    onUpdate: ({ editor: ed }) => {
      if (isProgrammaticRef.current) return;
      const text = ed.getText();
      setHasContent(text.length > 0);
      recomputeFromEditor(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (isProgrammaticRef.current) return;
      recomputeFromEditor(ed);
    },
    onFocus: ({ editor: ed }) => {
      recomputeFromEditor(ed);
    },
    onBlur: ({ editor: ed }) => {
      // Blur always submits (PRD-003a). Read the freshest text from the editor.
      const text = ed.getText().trim();
      applyRef.current(text);
      setSuggestion(CLOSED_SUGGESTION);
      setDropdownDismissed(false);
    },
    editorProps: {
      attributes: {
        spellcheck: "false",
      },
      handleKeyDown: (view, event) => {
        const text = view.state.doc.textContent;
        const cursorPos = view.state.selection.from - PARAGRAPH_OFFSET;
        const sState = getSuggestionState(text, cursorPos);
        const ui = suggestionRef.current;
        const highlighted =
          ui.state.open && ui.items.length > 0
            ? ui.items[ui.selectedIndex] ?? null
            : null;

        const action = handleKey(
          {
            text,
            cursorPos,
            suggestion: dismissedRef.current ? { open: false } : sState,
            highlightedText: dismissedRef.current ? null : highlighted,
          },
          event.key,
        );

        switch (action.kind) {
          case "noop":
            return false;
          case "submit":
            event.preventDefault();
            applyRef.current(action.text.trim());
            return true;
          case "blur":
            event.preventDefault();
            (view.dom as HTMLElement).blur();
            return true;
          case "close-dropdown":
            event.preventDefault();
            setDropdownDismissed(true);
            setSuggestion(CLOSED_SUGGESTION);
            return true;
          case "navigate":
            event.preventDefault();
            setSuggestion((prev) => {
              if (prev.items.length === 0) return prev;
              const delta = action.direction === "down" ? 1 : -1;
              const next =
                (prev.selectedIndex + delta + prev.items.length) %
                prev.items.length;
              return { ...prev, selectedIndex: next };
            });
            return true;
          case "accept": {
            event.preventDefault();
            const ed = editorRef.current;
            if (ed) applyAcceptToEditor(ed, action);
            return true;
          }
        }
      },
    },
  });

  // Keep editor ref in sync so handleKeyDown's accept branch can reach it.
  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  // ── Store → editor sync ────────────────────────────────────────────────
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.getText() === queryText) return;

    isProgrammaticRef.current = true;
    editor.commands.setContent(
      queryText
        ? {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: queryText }],
              },
            ],
          }
        : { type: "doc", content: [{ type: "paragraph" }] },
    );
    setHasContent(queryText.length > 0);
    isProgrammaticRef.current = false;
  }, [queryText, editor]);

  // ── Global `/` to focus ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;
      if (e.key === "/") {
        e.preventDefault();
        editor?.commands.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editor]);

  // ── Render ─────────────────────────────────────────────────────────────
  const showDropdown = suggestion.state.open && suggestion.items.length > 0;

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

      <Box
        flex={1}
        minWidth={0}
        position="relative"
        css={{
          "& .tiptap": {
            outline: "none",
            fontFamily: "var(--chakra-fonts-mono)",
            fontSize: "13px",
            lineHeight: "1.5",
            whiteSpace: "nowrap",
            overflowX: "auto",
            overflowY: "hidden",
            caretColor: "var(--chakra-colors-fg-DEFAULT)",
          },
          "& .tiptap p": { margin: 0 },
          "& .tiptap p.is-editor-empty:first-child::before": {
            color: "var(--chakra-colors-fg-subtle)",
            content: "attr(data-placeholder)",
            float: "left",
            height: 0,
            pointerEvents: "none",
          },
          "& .filter-token": {
            background:
              "color-mix(in srgb, var(--chakra-colors-blue-500) 14%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--chakra-colors-blue-500) 22%, transparent)",
            borderRadius: "4px",
            padding: "0px 4px",
            margin: "0 1px",
          },
          "& .filter-token-exclude": {
            background:
              "color-mix(in srgb, var(--chakra-colors-red-500) 14%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--chakra-colors-red-500) 22%, transparent)",
          },
        }}
      >
        <EditorContent editor={editor} />

        {showDropdown && (
          <Box
            position="absolute"
            top="calc(100% + 4px)"
            left={0}
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            borderRadius="lg"
            shadow="lg"
            zIndex={50}
            overflow="hidden"
            maxHeight="240px"
            overflowY="auto"
            minWidth="200px"
          >
            <VStack gap={0} align="stretch">
              {suggestion.items.map((label, index) => {
                const isSelected = index === suggestion.selectedIndex;
                const display =
                  suggestion.state.open && suggestion.state.mode === "value"
                    ? `${suggestion.state.field}:${label}`
                    : label;
                const colonIdx = display.indexOf(":");
                const field =
                  colonIdx >= 0 ? display.slice(0, colonIdx) : display;
                const value =
                  colonIdx >= 0 ? display.slice(colonIdx) : "";

                return (
                  <Button
                    key={label}
                    alignItems="center"
                    justifyContent="flex-start"
                    width="full"
                    height="auto"
                    minHeight="unset"
                    paddingX={3}
                    paddingY={1.5}
                    data-selected={isSelected || undefined}
                    _selected={{ bg: "blue.500/12" }}
                    _hover={{ bg: "blue.500/8" }}
                    onMouseDown={(e) => {
                      // Prevent blur — accept happens, editor stays focused.
                      e.preventDefault();
                      if (!editor) return;
                      const sState = suggestion.state;
                      if (!sState.open) return;
                      const text = editor.getText();
                      const cursorPos =
                        editor.state.selection.from - PARAGRAPH_OFFSET;
                      const action = handleKey(
                        {
                          text,
                          cursorPos,
                          suggestion: sState,
                          highlightedText: label,
                        },
                        "Enter",
                      );
                      if (action.kind === "accept") {
                        applyAcceptToEditor(editor, action);
                      }
                    }}
                    variant="ghost"
                    fontWeight="normal"
                    borderRadius={0}
                  >
                    <Text textStyle="xs" fontFamily="mono">
                      <Text as="span" color="fg" fontWeight="medium">
                        {field}
                      </Text>
                      <Text as="span" color="fg.muted">
                        {value}
                      </Text>
                    </Text>
                  </Button>
                );
              })}
            </VStack>
          </Box>
        )}
      </Box>

      {showCrossFacetWarning && (
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
      )}

      {hasContent && (
        <Button
          size="2xs"
          variant="ghost"
          flexShrink={0}
          fontWeight="normal"
          color="fg.subtle"
          onMouseDown={(e) => {
            // Prevent the editor blur from firing applyQueryText with stale text
            // before clearAll runs.
            e.preventDefault();
            clearAll();
            editor?.commands.clearContent();
            setHasContent(false);
            setSuggestion(CLOSED_SUGGESTION);
            setDropdownDismissed(false);
          }}
        >
          Clear
          <X size={12} />
        </Button>
      )}

      {parseError && (
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
            {parseError}
          </Text>
        </Box>
      )}
    </Flex>
  );
};
