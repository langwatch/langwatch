/**
 * One query, as the Queries tab's accordion shows it: the `LW.query`
 * handle, SQL, declared parameters, a Run button testing the CURRENT row
 * standalone, and its last result — whichever run produced one most recently.
 */

import { LwqlEditor, type LwqlParameter } from "@langwatch/analytics-browser-kit";
import {
  chakra,
  Accordion,
  Box,
  Button,
  Card,
  HStack,
  IconButton,
  Input,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ChevronDown, ChevronRight, Play, Trash2 } from "lucide-react";
import { useMemo } from "react";

import type { QueryLastRun } from "../../behavior/use-dashboard-widget-executor.ts";
import {
  type EditableQueryName,
  useEditableQueryName,
} from "../../behavior/use-editable-query-name.ts";
import { useLwqlDiagnostics } from "../../behavior/use-lwql-diagnostics.ts";
import { useLwqlSchema } from "../../behavior/use-lwql-schema.ts";
import {
  type DashboardWidgetQuery,
  RESERVED_PARAMETERS,
} from "../../model/dashboard-widget-definition.ts";
import { formatNumber } from "../../model/format.ts";
import { DashboardWidgetQueryParamsEditor } from "./dashboard-widget-query-params-editor.tsx";
import { DashboardWidgetQueryResultView } from "./dashboard-widget-query-result-view.tsx";

/** The one-line "683 rows · 53ms" (or error) a collapsed row shows without expanding. */
function runSummary(run: QueryLastRun | undefined): string | null {
  if (!run) return null;
  if (run.error) return `${run.error.title}`;
  if (!run.result) return null;
  const elapsedMs = run.result.statistics.elapsedMs;
  const rows = `${formatNumber(run.result.rows.length)} row${run.result.rows.length === 1 ? "" : "s"}`;
  return typeof elapsedMs === "number" ? `${rows} · ${elapsedMs}ms` : rows;
}

/** The parameters the SQL editor offers and colours: the reserved ones, then the declared. */
function editorParameters(declared: DashboardWidgetQuery["parameters"]): LwqlParameter[] {
  return [
    ...RESERVED_PARAMETERS.map((p) => ({ ...p, reserved: true })),
    ...(declared ?? []).map((p) => ({ name: p.name })),
  ];
}

interface DashboardWidgetQueryRowProps {
  /** The project the SQL editor reads its schema for. */
  projectId: string;
  /** This row's own Accordion.Item value — index-based, set by the panel. */
  value: string;
  /** Whether the panel currently has this row open — drives the chevron. */
  isOpen: boolean;
  query: DashboardWidgetQuery;
  /** Empty when this name collides with a sibling's — the panel computes it. */
  nameError: string | null;
  onChange: (next: DashboardWidgetQuery) => void;
  onRemove: () => void;
  canRemove: boolean;
  onRun: () => void;
  isRunning: boolean;
  lastRun: QueryLastRun | undefined;
}

export function DashboardWidgetQueryRow({
  projectId,
  value,
  isOpen,
  query,
  nameError,
  onChange,
  onRemove,
  canRemove,
  onRun,
  isRunning,
  lastRun,
}: DashboardWidgetQueryRowProps) {
  const summary = runSummary(lastRun);
  const nameEdit = useEditableQueryName({ query, onChange });
  const schema = useLwqlSchema({ projectId });
  const markers = useLwqlDiagnostics({ projectId, sql: query.sql });
  const parameters = useMemo(() => editorParameters(query.parameters), [query.parameters]);

  return (
    <Card.Root size="sm" width="full" marginBottom={3}>
      <Accordion.Item value={value} border="none">
        <Card.Body gap={2}>
          <HStack>
            {/* Chakra's own indicator applies no rotation here (verified:
                transform: none in both states) — pick the icon by hand so
                closed reliably reads ">" and open reliably reads "v". */}
            <Accordion.ItemTrigger
              aria-label={isOpen ? "Collapse query" : "Expand query"}
              width="auto"
              flexShrink={0}
              padding={1}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </Accordion.ItemTrigger>

            <QueryNameField edit={nameEdit} queryName={query.name} nameError={nameError} />

            <Spacer />
            {!nameEdit.isEditingName && summary && (
              <Text fontSize="11px" color={lastRun?.error ? "red.500" : "fg.muted"} truncate>
                {summary}
              </Text>
            )}
            <Button size="xs" variant="outline" loading={isRunning} onClick={onRun}>
              <Play size={14} /> Run
            </Button>
            <IconButton
              aria-label={`Delete query ${query.name}`}
              size="xs"
              variant="ghost"
              disabled={!canRemove}
              onClick={onRemove}
            >
              <Trash2 size={14} />
            </IconButton>
          </HStack>
          {nameError && (
            <Text fontSize="11px" color="red.500">
              {nameError}
            </Text>
          )}
          <Accordion.ItemContent>
            <VStack align="stretch" gap={2} paddingTop={2}>
              <Box
                height="140px"
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                overflow="hidden"
              >
                <LwqlEditor
                  schema={schema}
                  markers={markers}
                  value={query.sql}
                  onChange={(sql) => onChange({ ...query, sql })}
                  parameters={parameters}
                />
              </Box>

              <DashboardWidgetQueryParamsEditor
                params={query.parameters ?? []}
                onChange={(parameters) => onChange({ ...query, parameters })}
              />

              <DashboardWidgetQueryResultView run={lastRun} />
            </VStack>
          </Accordion.ItemContent>
        </Card.Body>
      </Accordion.Item>
    </Card.Root>
  );
}

/**
 * Click-to-edit query name, hand-rolled rather than reusing
 * EditableWidgetName: an `<input>` can't nest inside `Accordion.ItemTrigger`
 * (a `<button>`), so the name sits as a SIBLING, and the trigger keeps just the chevron.
 */
function QueryNameField({
  edit,
  queryName,
  nameError,
}: {
  edit: EditableQueryName;
  queryName: string;
  nameError: string | null;
}) {
  if (edit.isEditingName) {
    return (
      <Input
        ref={edit.inputRef}
        size="xs"
        fontFamily="mono"
        value={edit.draftName}
        onChange={(e) => edit.setDraftName(e.target.value)}
        onBlur={edit.commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") edit.commit();
          if (e.key === "Escape") edit.cancel();
        }}
        placeholder="query name: the LW.query(name, params) handle"
        borderColor={nameError ? "red.400" : undefined}
        width="auto"
        minWidth="140px"
      />
    );
  }
  return (
    <chakra.button
      type="button"
      textAlign="start"
      aria-label={`Rename query ${queryName || "(unnamed query)"}`}
      fontFamily="mono"
      fontSize="13px"
      truncate
      cursor="pointer"
      onClick={edit.startEditing}
    >
      {queryName || "(unnamed query)"}
    </chakra.button>
  );
}
