import { Box, Button, HStack, Text } from "@chakra-ui/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useState } from "react";

/**
 * Thin status bar that mirrors VS Code's bottom strip — cursor position,
 * problem counts, indentation, language, plus two distinct save actions:
 *  - Save (⌘S)         — persists, modal stays open
 *  - Save & Close (⌘↵) — persists, then dismisses
 *
 * Subscribes directly to the editor's cursor + marker events so it stays in
 * sync without prop drilling.
 */
export function EditorStatusBar({
  editor: editorInstance,
  monaco,
  language,
  onSave,
  onSaveAndClose,
}: {
  editor: editor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
  language: string;
  /** ⌘S — persist without dismissing. */
  onSave?: () => void;
  /** ⌘↵ — persist then close. */
  onSaveAndClose?: () => void;
}) {
  const modKey = useModifierKeyLabel();
  const [line, setLine] = useState(1);
  const [column, setColumn] = useState(1);
  const [selection, setSelection] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);

  useEffect(() => {
    if (!editorInstance || !monaco) return;
    const updatePosition = () => {
      const pos = editorInstance.getPosition();
      if (pos) {
        setLine(pos.lineNumber);
        setColumn(pos.column);
      }
      const sel = editorInstance.getSelection();
      const model = editorInstance.getModel();
      if (sel && model && !sel.isEmpty()) {
        setSelection(model.getValueInRange(sel).length);
      } else {
        setSelection(0);
      }
    };
    updatePosition();
    const posSub = editorInstance.onDidChangeCursorPosition(updatePosition);
    const selSub = editorInstance.onDidChangeCursorSelection(updatePosition);
    return () => {
      posSub.dispose();
      selSub.dispose();
    };
  }, [editorInstance, monaco]);

  useEffect(() => {
    if (!editorInstance || !monaco) return;
    const updateMarkers = () => {
      const model = editorInstance.getModel();
      if (!model) {
        setErrorCount(0);
        setWarningCount(0);
        return;
      }
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      let errors = 0;
      let warnings = 0;
      for (const m of markers) {
        if (m.severity === monaco.MarkerSeverity.Error) errors++;
        else if (m.severity === monaco.MarkerSeverity.Warning) warnings++;
      }
      setErrorCount(errors);
      setWarningCount(warnings);
    };
    updateMarkers();
    const sub = monaco.editor.onDidChangeMarkers(updateMarkers);
    return () => sub.dispose();
  }, [editorInstance, monaco]);

  const problemsLabel =
    errorCount + warningCount === 0
      ? "No problems"
      : `${errorCount > 0 ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : ""}${
          errorCount > 0 && warningCount > 0 ? ", " : ""
        }${warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}`;

  return (
    <HStack
      bg="bg.muted"
      color="fg.muted"
      borderTopWidth="1px"
      borderColor="border"
      paddingLeft={3}
      paddingRight={2}
      paddingY={1}
      minHeight="32px"
      fontSize="11px"
      fontFamily="mono"
      gap={3}
      borderBottomRadius="md"
      flexShrink={0}
    >
      <Text color="fg">{capitalize(language)}</Text>
      <Separator />
      <Text>
        Ln {line}, Col {column}
        {selection > 0 ? ` (${selection} selected)` : ""}
      </Text>
      <Separator />
      <Text color={errorCount > 0 ? "red.500" : warningCount > 0 ? "orange.500" : undefined}>
        {problemsLabel}
      </Text>
      <HStack flex={1} justify="flex-end" gap={3}>
        <Text>Spaces: 4</Text>
        <Separator />
        <Text>UTF-8</Text>
        <Separator />
        <Button
          size="xs"
          variant="outline"
          onClick={onSave}
          data-testid="code-editor-save"
        >
          Save
          <ShortcutHint>{modKey}S</ShortcutHint>
        </Button>
        <Button
          size="xs"
          colorPalette="blue"
          variant="solid"
          onClick={onSaveAndClose}
          data-testid="code-editor-save-and-close"
        >
          Save & Close
          <ShortcutHint>{modKey}↵</ShortcutHint>
        </Button>
      </HStack>
    </HStack>
  );
}

/**
 * Render `⌘` on macOS, `Ctrl` everywhere else, so the visible shortcut
 * matches what the keyboard listener actually fires on.
 */
function useModifierKeyLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+";
  return /Mac|iPhone|iPod|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
}

/**
 * Tiny dimmed shortcut hint next to a button label. Avoids Chakra's `Kbd`
 * (too chunky at small button sizes — thick border, shadow, big padding).
 * Inherits the button's own text colour so it adapts to both outline and
 * solid backgrounds without colour drift.
 */
function ShortcutHint({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as="span"
      ml={1.5}
      fontFamily="mono"
      fontSize="10px"
      letterSpacing="tight"
      opacity={0.6}
    >
      {children}
    </Box>
  );
}

function Separator() {
  return (
    <Text opacity={0.4} aria-hidden="true">
      ·
    </Text>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
