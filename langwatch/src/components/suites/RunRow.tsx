/**
 * Collapsible row for a single batch run in the run history list.
 *
 * Header: [chevron] [suiteName] . [scenarioNames] . [timeAgo] . [spacer] . [statusIcon] [passRate%]
 * Expanded: shows ScenarioTargetRow (list) or ScenarioGridCard (grid) for each scenario run.
 *
 * The header is rendered as a direct child of the scroll container (no wrapper Box)
 * so that `position: sticky` works correctly within the scrollport.
 */

import { Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";
import { Dialog } from "~/components/ui/dialog";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { BatchRun, BatchRunSummary } from "./run-history-transforms";
import { computeIterationMap, getScenarioDisplayNames } from "./run-history-transforms";
import { ScenarioRunContent } from "./ScenarioRunContent";
import { RunSummaryCounts } from "./RunSummaryCounts";
import { SummaryStatusIcon } from "./SummaryStatusIcon";
import { isCancellableStatus } from "./useCancelScenarioRun";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

type RunRowProps = {
  batchRun: BatchRun;
  summary: BatchRunSummary;
  isExpanded: boolean;
  onToggle: () => void;
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  expectedJobCount?: number;
  suiteName?: string;
  viewMode?: ViewMode;
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  onCancelAll?: () => void;
  isCancellingBatch?: boolean;
  cancellingJobId?: string | null;
};

export function RunRow({
  batchRun,
  summary,
  isExpanded,
  onToggle,
  resolveTargetName,
  onScenarioRunClick,
  expectedJobCount,
  suiteName,
  viewMode = "grid",
  onCancelRun,
  onCancelAll,
  isCancellingBatch = false,
  cancellingJobId,
}: RunRowProps) {
  const [isCancelAllDialogOpen, setIsCancelAllDialogOpen] = useState(false);
  const timeAgo = formatTimeAgoCompact(batchRun.timestamp);
  const scenarioNames = suiteName
    ? getScenarioDisplayNames({ scenarioRuns: batchRun.scenarioRuns })
    : "";

  const iterationMap = useMemo(
    () => computeIterationMap({ scenarioRuns: batchRun.scenarioRuns }),
    [batchRun.scenarioRuns],
  );

  const cancellableCount = useMemo(
    () => batchRun.scenarioRuns.filter((run) => isCancellableStatus(run.status)).length,
    [batchRun.scenarioRuns],
  );
  const hasCancellableRuns = cancellableCount > 0;

  return (
    <>
      {/* Run header - clickable to expand/collapse, sticky within scroll container */}
      <HStack
        as="button"
        width="full"
        paddingX={4}
        paddingY={3}
        gap={3}
        flexWrap="nowrap"
        _hover={{ bg: "bg.subtle" }}
        cursor="pointer"
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`Run from ${timeAgo ?? "unknown time"}`}
        position="sticky"
        top={0}
        zIndex={20}
        bg="bg.muted"
        borderBottom="1px solid"
        borderColor="border"
        data-testid="run-row-header"
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ flexShrink: 0 }} />
        ) : (
          <ChevronRight size={14} style={{ flexShrink: 0 }} />
        )}
        {suiteName && (
          <>
            <Text fontSize="sm" fontWeight="medium" color="fg.default" flexShrink={0}>
              {suiteName}
            </Text>
            <Text fontSize="sm" color="fg.muted" flexShrink={0}>
              &middot;
            </Text>
          </>
        )}
        {scenarioNames && (
          <>
            <Text fontSize="sm" color="fg.muted" truncate minWidth={0} flexShrink={1}>
              {scenarioNames}
            </Text>
            <Text fontSize="sm" color="fg.muted" flexShrink={0}>
              &middot;
            </Text>
          </>
        )}
        <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
          {timeAgo}
        </Text>
        {expectedJobCount != null && summary.totalCount < expectedJobCount && (
          <Text fontSize="xs" color="fg.muted" flexShrink={0}>
            {summary.totalCount} of {expectedJobCount}
          </Text>
        )}
        <Box flex={1} />
        {onCancelAll && hasCancellableRuns && (
          <HStack
            as="span"
            role="button"
            tabIndex={isCancellingBatch ? -1 : 0}
            gap={1}
            paddingX={2}
            paddingY={0.5}
            borderRadius="sm"
            fontSize="xs"
            color="red.500"
            cursor={isCancellingBatch ? "default" : "pointer"}
            opacity={isCancellingBatch ? 0.6 : 1}
            _hover={isCancellingBatch ? undefined : { bg: "red.50" }}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              if (!isCancellingBatch) setIsCancelAllDialogOpen(true);
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (!isCancellingBatch && (e.key === "Enter" || e.key === " ")) {
                e.stopPropagation();
                e.preventDefault();
                setIsCancelAllDialogOpen(true);
              }
            }}
            aria-label="Cancel all remaining runs"
            aria-disabled={isCancellingBatch}
            data-testid="cancel-all-button"
          >
            {isCancellingBatch ? <Spinner size="xs" /> : <X size={12} />}
            <Text fontSize="xs">Cancel All</Text>
          </HStack>
        )}
        <SummaryStatusIcon summary={summary} />
        <RunSummaryCounts summary={summary} />
      </HStack>

      {/* Expanded content - scenario results in list or grid */}
      {isExpanded && (
        <>
          <ScenarioRunContent
            scenarioRuns={batchRun.scenarioRuns}
            viewMode={viewMode}
            resolveTargetName={resolveTargetName}
            onScenarioRunClick={onScenarioRunClick}
            iterationMap={iterationMap}
            onCancelRun={onCancelRun}
            cancellingJobId={cancellingJobId}
          />
          {batchRun.scenarioRuns.length === 0 && (
            <Text fontSize="sm" color="fg.muted" paddingX={4} paddingY={3}>
              No scenario runs in this batch.
            </Text>
          )}
        </>
      )}

      {/* Confirmation dialog for cancelling all remaining jobs */}
      {onCancelAll && (
        <Dialog.Root
          open={isCancelAllDialogOpen}
          onOpenChange={({ open }) => setIsCancelAllDialogOpen(open)}
        >
          <Dialog.Content maxWidth="sm">
            <Dialog.Header>
              <Dialog.Title>Cancel remaining jobs?</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text fontSize="sm" color="fg.muted">
                This will cancel {cancellableCount} remaining{" "}
                {cancellableCount === 1 ? "job" : "jobs"} in this batch run.
                This action cannot be undone.
              </Text>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                variant="outline"
                onClick={() => setIsCancelAllDialogOpen(false)}
              >
                Keep running
              </Button>
              <Button
                colorPalette="red"
                onClick={() => {
                  setIsCancelAllDialogOpen(false);
                  onCancelAll();
                }}
                data-testid="confirm-cancel-all-button"
              >
                Cancel {cancellableCount} {cancellableCount === 1 ? "job" : "jobs"}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
}
