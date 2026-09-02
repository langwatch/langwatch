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
  Span,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, Play, Trash2 } from "lucide-react";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";
import { formatNumber } from "~/utils/formatNumber";

import { DashboardWidgetCodeEditor } from "./DashboardWidgetCodeEditor";
import { DashboardWidgetQueryParamsEditor } from "./DashboardWidgetQueryParamsEditor";
import { DashboardWidgetQueryResultView } from "./DashboardWidgetQueryResultView";
import type { QueryLastRun } from "./useDashboardWidgetExecutor";

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

  return (
    <Card.Root size="sm" width="full" marginBottom={3}>
      <Accordion.Item value={query.name || "(unnamed)"} border="none">
        <Card.Body gap={2}>
          <HStack>
            <Accordion.ItemTrigger flex={1} minWidth={0}>
              <Accordion.ItemIndicator>
                <ChevronDown size={14} />
              </Accordion.ItemIndicator>
              <Span fontFamily="mono" fontSize="13px" truncate>
                {query.name || "(unnamed query)"}
              </Span>
              {summary && (
                <Text
                  fontSize="11px"
                  color={lastRun?.error ? "red.500" : "fg.muted"}
                  truncate
                >
                  {summary}
                </Text>
              )}
            </Accordion.ItemTrigger>
            <Button
              size="xs"
              variant="outline"
              loading={isRunning}
              onClick={(e) => {
                e.stopPropagation();
                onRun();
              }}
            >
              <Play size={14} /> Run
            </Button>
            <IconButton
              aria-label={`Delete query ${query.name}`}
              size="xs"
              variant="ghost"
              disabled={!canRemove}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          </HStack>
          <Accordion.ItemContent>
            <VStack align="stretch" gap={2} paddingTop={2}>
              <Box>
                <Input
                  size="xs"
                  fontFamily="mono"
                  value={query.name}
                  onChange={(e) => onChange({ ...query, name: e.target.value })}
                  placeholder="query name — the LW.query(name, params) handle"
                  borderColor={nameError ? "red.400" : undefined}
                />
                {nameError && (
                  <Text fontSize="11px" color="red.500" marginTop={1}>
                    {nameError}
                  </Text>
                )}
              </Box>

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
                />
              </Box>

              <DashboardWidgetQueryParamsEditor
                params={query.parameters ?? []}
                onChange={(parameters) => onChange({ ...query, parameters })}
              />

              <Text fontSize="11px" color="fg.muted">
                Last result
              </Text>
              <DashboardWidgetQueryResultView run={lastRun} />
            </VStack>
          </Accordion.ItemContent>
        </Card.Body>
      </Accordion.Item>
    </Card.Root>
  );
}
