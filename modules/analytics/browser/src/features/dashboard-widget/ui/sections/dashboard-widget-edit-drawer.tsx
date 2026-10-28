/**
 * The widget editor: a wide drawer with a live chart preview, Code and
 * Queries tabs (plus any a caller adds), holding no draft state — every value
 * and handler comes from the card that opened it, so both read/write the same state.
 */

import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { Card } from "@langwatch/design-system/card";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { Drawer, setDrawerEndInset } from "@langwatch/design-system/drawer";
import { Box, Button } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";
import { type ReactNode, useLayoutEffect, useMemo } from "react";

import type { QueryLastRun } from "../../behavior/use-dashboard-widget-executor.ts";
import { DashboardWidgetCodeEditor } from "./dashboard-widget-code-editor.tsx";
import {
  DashboardWidgetQueriesPanel,
  nextQueryName,
  queryNamesAreValid,
} from "./dashboard-widget-queries-panel.tsx";
import { declaredParamsAreValid } from "./dashboard-widget-query-params-editor.tsx";
import { EditableWidgetName } from "./editable-widget-name.tsx";

/** The two tabs every widget editor has. */
type WidgetEditTab = "code" | "queries";

/** A tab a caller adds after Code and Queries, with its own panel. */
export interface WidgetEditExtraTab<Tab extends string> {
  value: Tab;
  label: string;
  content: ReactNode;
}

interface DashboardWidgetEditDrawerProps<Tab extends string> {
  open: boolean;
  /** The project the queries' SQL editor reads its schema for. */
  projectId: string;
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
  activeTab: WidgetEditTab | NoInfer<Tab>;
  onTabChange: (tab: WidgetEditTab | NoInfer<Tab>) => void;
  /** Tabs after Code and Queries. */
  extraTabs?: readonly WidgetEditExtraTab<Tab>[];
  /** Shown between the preview and the tabs, such as an assistant's suggestions. */
  assist?: ReactNode;
  /** Shown above the queries on the Queries tab: settings that are part of the query. */
  querySettings?: ReactNode;
  /** The side it opens from; "start" leaves a panel docked on the right in view. */
  placement?: "start" | "end";
  /** Room kept free at the far edge, so a panel docked there sits beside the drawer. */
  reserveEndPx?: number;
}

/** Holds room free at the right edge while open, so a panel docked there stays in view. */
function useReservedEndInset({ open, reserveEndPx }: { open: boolean; reserveEndPx?: number }) {
  useLayoutEffect(() => {
    if (!open || reserveEndPx === void 0) return;
    setDrawerEndInset(reserveEndPx);
    return () => setDrawerEndInset(0);
  }, [open, reserveEndPx]);
}

/** Why Save is off, or undefined when the draft can be saved. */
function saveBlockedReason({
  isDirty,
  queries,
}: {
  isDirty: boolean;
  queries: DashboardWidgetQuery[];
}): string | undefined {
  if (!isDirty) return "No changes to save";
  if (!queryNamesAreValid(queries)) return "Give every query a non-empty, unique name";
  if (!declaredParamsAreValid(queries)) return "A declared parameter has an invalid name";
  return void 0;
}

export function DashboardWidgetEditDrawer<Tab extends string = WidgetEditTab>({
  open,
  projectId,
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
  extraTabs = [],
  assist,
  querySettings,
  placement = "end",
  reserveEndPx,
}: DashboardWidgetEditDrawerProps<Tab>) {
  useReservedEndInset({ open, reserveEndPx });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="xl"
      placement={placement}
      title={name === "" ? "Widget" : name}
      titleContent={
        <EditableWidgetName name={name} id={id} onRename={onNameChange} fontSize="md" />
      }
      bodyScroll="content"
      footer={{
        cancel: { onClick: onClose, "data-testid": "analytics-widget-cancel" },
        primaryAction: {
          label: "Save",
          onClick: onSave,
          loading: isSaving,
          disabledReason: saveBlockedReason({ isDirty, queries }),
          "data-testid": "analytics-widget-save",
        },
        busy: isSaving,
      }}
    >
      {chart && (
        <Box flexShrink={0} marginBottom={3}>
          {chart}
        </Box>
      )}
      {assist && (
        <Box flexShrink={0} marginBottom={3}>
          {assist}
        </Box>
      )}
      <WidgetEditTabs
        projectId={projectId}
        extraTabs={extraTabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        code={code}
        onCodeChange={onCodeChange}
        queries={queries}
        onQueriesChange={onQueriesChange}
        lastRuns={lastRuns}
        onRun={onRun}
        querySettings={querySettings}
      />
    </Drawer>
  );
}

/** The Code / Queries tab switcher, any added tabs, and their full-height panels. */
function WidgetEditTabs<Tab extends string>({
  projectId,
  extraTabs,
  activeTab,
  onTabChange,
  code,
  onCodeChange,
  queries,
  onQueriesChange,
  lastRuns,
  onRun,
  querySettings,
}: {
  projectId: string;
  extraTabs: readonly WidgetEditExtraTab<Tab>[];
  activeTab: WidgetEditTab | Tab;
  onTabChange: (tab: WidgetEditTab | Tab) => void;
  code: string;
  onCodeChange: (code: string) => void;
  queries: DashboardWidgetQuery[];
  onQueriesChange: (queries: DashboardWidgetQuery[]) => void;
  lastRuns: Record<string, QueryLastRun>;
  onRun: (query: DashboardWidgetQuery) => Promise<void>;
  querySettings?: ReactNode;
}) {
  const queryColumns = useMemo(
    () =>
      queries.flatMap((query) => {
        const columns = lastRuns[query.name]?.result?.columns;
        return columns ? [{ name: query.name, columns }] : [];
      }),
    [queries, lastRuns],
  );
  return (
    <ContentTabs
      value={activeTab}
      onValueChange={({ value }) => onTabChange(value)}
      label="Widget editor"
      body="flush"
      scroll="content"
      mount="all"
      actions={
        activeTab === "queries" ? (
          <AddQueryButton queries={queries} onQueriesChange={onQueriesChange} />
        ) : (
          void 0
        )
      }
      items={[
        {
          value: "code",
          label: "Code",
          testId: "analytics-widget-tab-code",
          content: (
            <Box flex={1} minHeight={0} display="flex" flexDirection="column" paddingTop={3}>
              <Card variant="frame-fill">
                <Box flex={1} minHeight={0}>
                  <DashboardWidgetCodeEditor
                    value={code}
                    onChange={onCodeChange}
                    queryColumns={queryColumns}
                  />
                </Box>
              </Card>
            </Box>
          ),
        },
        {
          value: "queries",
          label: `Queries (${queries.length})`,
          testId: "analytics-widget-tab-queries",
          content: (
            <Box flex={1} minHeight={0} display="flex" flexDirection="column" paddingTop={3}>
              {querySettings && (
                <Box flexShrink={0} marginBottom={3}>
                  {querySettings}
                </Box>
              )}
              <DashboardWidgetQueriesPanel
                projectId={projectId}
                queries={queries}
                onChange={onQueriesChange}
                lastRuns={lastRuns}
                onRun={onRun}
              />
            </Box>
          ),
        },
        ...extraTabs.map(({ value, label, content }) => ({
          value,
          label,
          content: (
            <Box flex={1} minHeight={0} overflowY="auto" paddingTop={3}>
              {content}
            </Box>
          ),
        })),
      ]}
    />
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
      data-testid="analytics-widget-add-query"
      onClick={() => onQueriesChange([...queries, { name: nextQueryName(queries), sql: "" }])}
    >
      <Plus size={14} /> Add query
    </Button>
  );
}
