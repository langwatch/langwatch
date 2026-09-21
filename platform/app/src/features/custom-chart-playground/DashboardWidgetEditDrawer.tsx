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

import { Box, Button, Spacer, Tabs } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Drawer } from "~/components/ui/drawer";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";

import { DashboardWidgetCodeEditor } from "./DashboardWidgetCodeEditor";
import {
  DashboardWidgetQueriesPanel,
  nextQueryName,
  queryNamesAreValid,
} from "./DashboardWidgetQueriesPanel";
import { declaredParamsAreValid } from "./DashboardWidgetQueryParamsEditor";
import { EditableWidgetName } from "./EditableWidgetName";
import type { QueryLastRun } from "./useDashboardWidgetExecutor";

interface DashboardWidgetEditDrawerProps {
  open: boolean;
  /** The live chart preview, already built by the card — null while closed. */
  chart: ReactNode;
  /** Omitted before the first Save — a widget that doesn't exist yet has no id. */
  id?: string;
  name: string;
  onNameChange: (name: string) => void;
  code: string;
  queries: DashboardWidgetQuery[];
  onCodeChange: (code: string) => void;
  onQueriesChange: (queries: DashboardWidgetQuery[]) => void;
  lastRuns: Record<string, QueryLastRun>;
  onRun: (query: DashboardWidgetQuery) => Promise<void>;
  isDirty: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: () => void;
  activeTab: "code" | "queries";
  onTabChange: (tab: "code" | "queries") => void;
}

export function DashboardWidgetEditDrawer({
  open,
  chart,
  id,
  name,
  onNameChange,
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
  activeTab,
  onTabChange,
}: DashboardWidgetEditDrawerProps) {
  const canSave =
    isDirty && queryNamesAreValid(queries) && declaredParamsAreValid(queries);

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
          <EditableWidgetName
            name={name}
            id={id}
            onRename={onNameChange}
            fontSize="md"
          />
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
          <WidgetEditTabs
            activeTab={activeTab}
            onTabChange={onTabChange}
            code={code}
            onCodeChange={onCodeChange}
            queries={queries}
            onQueriesChange={onQueriesChange}
            lastRuns={lastRuns}
            onRun={onRun}
          />
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

/** The Code / Queries tab switcher and its two full-height panels. */
function WidgetEditTabs({
  activeTab,
  onTabChange,
  code,
  onCodeChange,
  queries,
  onQueriesChange,
  lastRuns,
  onRun,
}: {
  activeTab: "code" | "queries";
  onTabChange: (tab: "code" | "queries") => void;
  code: string;
  onCodeChange: (code: string) => void;
  queries: DashboardWidgetQuery[];
  onQueriesChange: (queries: DashboardWidgetQuery[]) => void;
  lastRuns: Record<string, QueryLastRun>;
  onRun: (query: DashboardWidgetQuery) => Promise<void>;
}) {
  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(e) => onTabChange(e.value as "code" | "queries")}
      colorPalette="orange"
      size="sm"
      display="flex"
      flexDirection="column"
      flex={1}
      minHeight={0}
    >
      {/* Same Tabs setup as the HTTP agent's Body/Auth toggle
          (`components/agents/http/HttpConfigEditor.tsx`) — a bottom
          border on the list plus `colorPalette` is enough for Chakra's
          own recipe to show the selected tab; no hand-rolled
          `Tabs.Indicator`. */}
      <Tabs.List
        flexShrink={0}
        alignItems="center"
        borderBottomWidth="1px"
        borderColor="border"
      >
        <Tabs.Trigger value="code">Code</Tabs.Trigger>
        <Tabs.Trigger value="queries">Queries ({queries.length})</Tabs.Trigger>
        <Spacer />
        {activeTab === "queries" && (
          <AddQueryButton queries={queries} onQueriesChange={onQueriesChange} />
        )}
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
          <DashboardWidgetCodeEditor
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
        <DashboardWidgetQueriesPanel
          queries={queries}
          onChange={onQueriesChange}
          lastRuns={lastRuns}
          onRun={onRun}
        />
      </Tabs.Content>
    </Tabs.Root>
  );
}

/** Appends a fresh, uniquely-named empty query to the list. */
function AddQueryButton({
  queries,
  onQueriesChange,
}: {
  queries: DashboardWidgetQuery[];
  onQueriesChange: (queries: DashboardWidgetQuery[]) => void;
}) {
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={() =>
        onQueriesChange([...queries, { name: nextQueryName(queries), sql: "" }])
      }
    >
      <Plus size={14} /> Add query
    </Button>
  );
}
