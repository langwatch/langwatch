/**
 * The widget editor: a wide drawer with a live chart preview pinned at the
 * top, above two full-height tabs — Code (the React/TSX file) and Queries
 * (every declared query: SQL, params, last result, standalone Run). Cards
 * are presentation-only; this drawer is the only place a widget's code or
 * queries are edited.
 *
 * Holds no draft state of its own — every value and every change handler
 * comes from the card that opened it, which is what makes the preview
 * live-update as this drawer edits: both read and write the exact same
 * state. The preview element itself is built by the card too (`chart`) —
 * this file only decides where it sits, not what it is, since the card is
 * also where the executor and the debounce that feeds it live.
 */

import { Box, Button, Tabs } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { Drawer } from "~/components/ui/drawer";
import type { PlaygroundQuery } from "~/server/analytics/playgroundWidgetDefinition";

import { PlaygroundCodeEditor } from "./PlaygroundCodeEditor";
import {
  PlaygroundQueriesPanel,
  queryNamesAreValid,
} from "./PlaygroundQueriesPanel";
import type { QueryLastRun } from "./usePlaygroundWidgetExecutor";

interface PlaygroundWidgetEditDrawerProps {
  open: boolean;
  /** The live chart preview, already built by the card — null while closed. */
  chart: ReactNode;
  code: string;
  queries: PlaygroundQuery[];
  onCodeChange: (code: string) => void;
  onQueriesChange: (queries: PlaygroundQuery[]) => void;
  lastRuns: Record<string, QueryLastRun>;
  onRun: (query: PlaygroundQuery) => Promise<void>;
  isDirty: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function PlaygroundWidgetEditDrawer({
  open,
  chart,
  code,
  queries,
  onCodeChange,
  onQueriesChange,
  lastRuns,
  onRun,
  isDirty,
  isSaving,
  onClose,
  onSave,
}: PlaygroundWidgetEditDrawerProps) {
  const canSave = isDirty && queryNamesAreValid(queries);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      size="xl"
    >
      <Drawer.Content display="flex" flexDirection="column">
        <Drawer.Header>
          <Drawer.Title>Edit widget</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body
          display="flex"
          flexDirection="column"
          minHeight={0}
          flex={1}
        >
          {chart && (
            <Box flexShrink={0} marginBottom={3}>
              {chart}
            </Box>
          )}
          <Tabs.Root
            defaultValue="code"
            variant="line"
            size="sm"
            display="flex"
            flexDirection="column"
            flex={1}
            minHeight={0}
          >
            <Tabs.List flexShrink={0}>
              <Tabs.Trigger value="code">Code</Tabs.Trigger>
              <Tabs.Trigger value="queries">
                Queries ({queries.length})
              </Tabs.Trigger>
              <Tabs.Indicator />
            </Tabs.List>

            <Tabs.Content
              value="code"
              flex={1}
              minHeight={0}
              display="flex"
              flexDirection="column"
              paddingTop={3}
            >
              <Box
                flex={1}
                minHeight={0}
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                overflow="hidden"
              >
                <PlaygroundCodeEditor
                  language="typescript"
                  value={code}
                  onChange={onCodeChange}
                />
              </Box>
            </Tabs.Content>

            <Tabs.Content
              value="queries"
              flex={1}
              minHeight={0}
              display="flex"
              flexDirection="column"
              paddingTop={3}
            >
              <PlaygroundQueriesPanel
                queries={queries}
                onChange={onQueriesChange}
                lastRuns={lastRuns}
                onRun={onRun}
              />
            </Tabs.Content>
          </Tabs.Root>
        </Drawer.Body>
        <Drawer.Footer flexShrink={0}>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            colorPalette="orange"
            loading={isSaving}
            disabled={!canSave}
            onClick={onSave}
          >
            Save
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
