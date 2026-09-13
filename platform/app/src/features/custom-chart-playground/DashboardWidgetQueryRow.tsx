/**
 * One query, as the Queries tab's accordion shows it: the `LW.query` handle
 * (name), its SQL, its declared parameters, a Run button that tests the
 * CURRENT row content standalone (no chart involved), and its last result —
 * whichever run, live or standalone, produced one most recently.
 */

import {
  Accordion,
  Box,
  Button,
  Card,
  HStack,
  IconButton,
  Input,
  Spacer,
  Span,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight, Play, Trash2 } from "lucide-react";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";
import { formatNumber } from "~/utils/formatNumber";

import { DashboardWidgetCodeEditor } from "./DashboardWidgetCodeEditor";
import { DashboardWidgetQueryParamsEditor } from "./DashboardWidgetQueryParamsEditor";
import { DashboardWidgetQueryResultView } from "./DashboardWidgetQueryResultView";
import type { QueryLastRun } from "./useDashboardWidgetExecutor";
import {
  type EditableQueryName,
  useEditableQueryName,
} from "./useEditableQueryName";

/** The one-line "683 rows · 53ms" (or error) a collapsed row shows without expanding. */
function runSummary(run: QueryLastRun | undefined): string | null {
  if (!run) return null;
  if (run.error) return `${run.error.title}`;
  if (!run.result) return null;
  const elapsedMs = run.result.statistics.elapsedMs;
  const rows = `${formatNumber(run.result.rows.length)} row${run.result.rows.length === 1 ? "" : "s"}`;
  return typeof elapsedMs === "number" ? `${rows} · ${elapsedMs}ms` : rows;
}

interface DashboardWidgetQueryRowProps {
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

            <QueryNameField
              edit={nameEdit}
              queryName={query.name}
              nameError={nameError}
            />

            <Spacer />
            {!nameEdit.isEditingName && summary && (
              <Text
                fontSize="11px"
                color={lastRun?.error ? "red.500" : "fg.muted"}
                truncate
              >
                {summary}
              </Text>
            )}
            <Button
              size="xs"
              variant="outline"
              loading={isRunning}
              onClick={onRun}
            >
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
                <DashboardWidgetCodeEditor
                  language="sql"
                  value={query.sql}
                  onChange={(sql) => onChange({ ...query, sql })}
                  declaredParamNames={(query.parameters ?? []).map(
                    (p) => p.name,
                  )}
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
 * Click-to-edit query name, same pattern as EditableWidgetName — but
 * hand-rolled rather than reused: that component is sized for a card title (a
 * tooltip, a fading pencil icon), and an `<input>` can't nest inside
 * `Accordion.ItemTrigger` (it renders a `<button>`), so the name lives as a
 * SIBLING of the trigger rather than inside it. The trigger itself shrinks to
 * just the chevron — the one thing that still toggles the row.
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
        placeholder="query name — the LW.query(name, params) handle"
        borderColor={nameError ? "red.400" : undefined}
        width="auto"
        minWidth="140px"
      />
    );
  }
  return (
    <Span
      role="button"
      tabIndex={0}
      aria-label={`Rename query ${queryName || "(unnamed query)"}`}
      fontFamily="mono"
      fontSize="13px"
      truncate
      cursor="pointer"
      onClick={edit.startEditing}
      onKeyDown={(e) => {
        // A focusable span is not a real button; activate Enter/Space by hand
        // so the rename stays reachable without a pointer.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          edit.startEditing();
        }
      }}
    >
      {queryName || "(unnamed query)"}
    </Span>
  );
}
