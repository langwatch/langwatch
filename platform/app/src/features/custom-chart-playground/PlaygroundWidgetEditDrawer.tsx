/**
 * Per-widget editor: a drawer with two Monaco panes — the sandboxed author
 * file and its primary query's LangWatchQL statement — plus Save. Save
 * persists both through the parent; the drawer holds only the in-flight draft.
 *
 * A card's own Chart | Code toggle edits the file in place against the same
 * mutation. This drawer is the surface that also reaches the SQL.
 *
 * Edits only `queries[0]` for now — there is no UI yet to add, rename or
 * remove a query. Any further entries in `widget.queries` are carried through
 * untouched on save rather than dropped, so they survive once that UI lands.
 */

import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import type { PlaygroundQuery } from "~/server/analytics/playgroundWidgetDefinition";

import { PlaygroundCodeEditor } from "./PlaygroundCodeEditor";
import type { PlaygroundWidget } from "./PlaygroundWidgetCard";

/** The name a widget's first query gets when one didn't already exist. */
const DEFAULT_QUERY_NAME = "main";

interface PlaygroundWidgetEditDrawerProps {
  widget: PlaygroundWidget | null;
  onClose: () => void;
  onSave: (input: {
    id: string;
    code: string;
    queries: PlaygroundQuery[];
  }) => void;
  isSaving: boolean;
}

export function PlaygroundWidgetEditDrawer({
  widget,
  onClose,
  onSave,
  isSaving,
}: PlaygroundWidgetEditDrawerProps) {
  const [code, setCode] = useState("");
  const [sql, setSql] = useState("");

  // Reseed the drafts each time a different widget opens the drawer.
  useEffect(() => {
    if (widget) {
      setCode(widget.code);
      setSql(widget.queries[0]?.sql ?? "");
    }
  }, [widget]);

  const handleSave = () => {
    if (!widget) return;
    const [primary, ...rest] = widget.queries;
    const queries: PlaygroundQuery[] = [
      { ...(primary ?? { name: DEFAULT_QUERY_NAME }), sql },
      ...rest,
    ];
    onSave({ id: widget.id, code, queries });
  };

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
                widget.tsx
              </Text>
              <Box
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                flex={1}
                minHeight="240px"
              >
                <PlaygroundCodeEditor
                  language="typescript"
                  value={code}
                  onChange={setCode}
                />
              </Box>
            </VStack>

            <VStack align="stretch" gap={1} flex={1} minHeight="200px">
              <Text fontSize="13px" fontWeight="600">
                {widget?.queries[0]?.name ?? DEFAULT_QUERY_NAME} (LangWatchQL)
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
          <Button colorPalette="orange" loading={isSaving} onClick={handleSave}>
            Save
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
