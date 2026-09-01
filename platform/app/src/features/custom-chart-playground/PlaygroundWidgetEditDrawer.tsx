/**
 * Per-widget editor: a drawer with two Monaco panes — the sandboxed author
 * HTML and the LangWatchQL statement — plus Save. Save persists both through
 * the parent; the drawer holds only the in-flight draft.
 */

import { Box, Button, Text, VStack } from "@chakra-ui/react";
import type { editor } from "monaco-editor";
import { useEffect, useState } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import { Drawer } from "~/components/ui/drawer";
import dynamic from "~/utils/compat/next-dynamic";

import type { PlaygroundWidget } from "./PlaygroundWidgetCard";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading the editor
    </Box>
  ),
});

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 12,
  wordWrap: "on",
  automaticLayout: true,
  scrollBeyondLastLine: false,
  lineNumbers: "on",
  folding: true,
};

interface PlaygroundWidgetEditDrawerProps {
  widget: PlaygroundWidget | null;
  onClose: () => void;
  onSave: (input: { id: string; srcdocHtml: string; sql: string }) => void;
  isSaving: boolean;
}

export function PlaygroundWidgetEditDrawer({
  widget,
  onClose,
  onSave,
  isSaving,
}: PlaygroundWidgetEditDrawerProps) {
  const { colorMode } = useColorMode();
  const monacoTheme = colorMode === "dark" ? "vs-dark" : "vs";

  const [html, setHtml] = useState("");
  const [sql, setSql] = useState("");

  // Reseed the drafts each time a different widget opens the drawer.
  useEffect(() => {
    if (widget) {
      setHtml(widget.srcdocHtml);
      setSql(widget.sql);
    }
  }, [widget]);

  return (
    <Drawer.Root
      open={widget !== null}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      size="xl"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit widget</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          <VStack align="stretch" gap={4} height="full">
            <VStack align="stretch" gap={1} flex={1} minHeight="240px">
              <Text fontSize="13px" fontWeight="600">
                Chart HTML
              </Text>
              <Box
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                flex={1}
                minHeight="240px"
              >
                <MonacoEditor
                  height="100%"
                  language="html"
                  value={html}
                  theme={monacoTheme}
                  onChange={(v: string | undefined) => setHtml(v ?? "")}
                  options={EDITOR_OPTIONS}
                />
              </Box>
            </VStack>

            <VStack align="stretch" gap={1} flex={1} minHeight="200px">
              <Text fontSize="13px" fontWeight="600">
                SQL (LangWatchQL)
              </Text>
              <Box
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                flex={1}
                minHeight="200px"
              >
                <MonacoEditor
                  height="100%"
                  language="sql"
                  value={sql}
                  theme={monacoTheme}
                  onChange={(v: string | undefined) => setSql(v ?? "")}
                  options={EDITOR_OPTIONS}
                />
              </Box>
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            colorPalette="orange"
            loading={isSaving}
            onClick={() => {
              if (widget) onSave({ id: widget.id, srcdocHtml: html, sql });
            }}
          >
            Save
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
