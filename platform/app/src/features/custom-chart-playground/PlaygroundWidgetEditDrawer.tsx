/**
 * Per-widget editor: a drawer with two Monaco panes — the sandboxed author
 * HTML and the LangWatchQL statement — plus Save. Save persists both through
 * the parent; the drawer holds only the in-flight draft.
 *
 * A card's own Chart | Code toggle edits the HTML in place against the same
 * mutation. This drawer is the surface that also reaches the SQL.
 */

import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";

import { PlaygroundCodeEditor } from "./PlaygroundCodeEditor";
import type { PlaygroundWidget } from "./PlaygroundWidgetCard";

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
                <PlaygroundCodeEditor
                  language="html"
                  value={html}
                  onChange={setHtml}
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
                <PlaygroundCodeEditor
                  language="sql"
                  value={sql}
                  onChange={setSql}
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
