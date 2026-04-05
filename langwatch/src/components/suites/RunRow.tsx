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
import { ChevronDown, ChevronRight, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { BatchRun, BatchRunSummary } from "./run-history-transforms";
import { computeIterationMap, getScenarioDisplayNames } from "./run-history-transforms";
import { ScenarioRunContent } from "./ScenarioRunContent";
import { RunMetricsSummary } from "./RunMetricsSummary";
import { isCancellableStatus } from "./useCancelScenarioRun";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

type RunRowLoadingProps = {
  loading: true;
  suiteName?: string;
};

type RunRowDataProps = {
  loading?: false;
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
  isHighlighted?: boolean;
};

type RunRowProps = RunRowLoadingProps | RunRowDataProps;

export function RunRow(props: RunRowProps) {
  if (props.loading) {
    return <RunRowLoading suiteName={props.suiteName} />;
  }
  return <RunRowData {...props} />;
}

function RunRowLoading({ suiteName }: { suiteName?: string }) {
  return (
    <Box>
      <Box padding={2} paddingBottom={0} width="full" position="sticky" top={0} zIndex={20}>
        <HStack
          width="full"
          paddingX={4}
          paddingY={3}
          gap={3}
          flexWrap="nowrap"
          bg="bg.subtle/50"
          backdropFilter="blur(4px)"
          data-testid="run-row-header"
          borderRadius="lg"
          boxShadow="xs"
        >
          <Spinner size="xs" color="fg.muted" css={{ flexShrink: 0 }} />
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
          <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
            Starting...
          </Text>
          <Box flex={1} />
        </HStack>
      </Box>
      <Box padding={2} />
    </Box>
  );
}

function RunRowData({
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
  isHighlighted = false,
}: RunRowDataProps) {
  const [isCancelAllDialogOpen, setIsCancelAllDialogOpen] = useState(false);
  const now = useNow();
  const timeAgo = formatTimeAgoCompact(batchRun.timestamp, now);
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
    <Box
      data-batch-id={batchRun.batchRunId}
      css={isHighlighted ? {
        "@keyframes yellowFlash": {
          "0%": { backgroundColor: "rgba(234, 179, 8, 0.3)" },
          "100%": { backgroundColor: "transparent" },
        },
        animation: "yellowFlash 2s ease-out",
      } : undefined}
    >
      {/* Run header - clickable to expand/collapse, sticky within scroll container */}
      <Box padding={2} paddingBottom={0} width="full" position="sticky" top={0} zIndex={20}>
        <HStack
          as="button"
          width="full"
          paddingX={4}
          paddingY={3}
          gap={3}
          flexWrap="nowrap"
          cursor="pointer"
          onClick={onToggle}
          className="group"
          aria-expanded={isExpanded}
          aria-label={`Run from ${timeAgo ?? "unknown time"}`}
          bg="bg.subtle/50"
          backdropFilter="blur(4px)"
          data-testid="run-row-header"
          borderRadius="lg"
          boxShadow="xs"
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
          {onCancelAll && hasCancellableRuns && (
            <HStack
              as="span"
              role="button"
              tabIndex={isCancellingBatch ? -1 : 0}
              gap={1}
              paddingX={2}
              paddingY={0.5}
              borderRadius="md"
              border="1px solid"
              borderColor="red.200"
              fontSize="xs"
              color="red.600"
              cursor={isCancellingBatch ? "default" : "pointer"}
              flexShrink={0}
              opacity={isCancellingBatch ? 0.6 : 1}
              _hover={isCancellingBatch ? undefined : { bg: "red.50", borderColor: "red.300" }}
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
              aria-label="Stop all remaining runs"
              aria-disabled={isCancellingBatch}
              data-testid="cancel-all-button"
            >
              {isCancellingBatch ? <Spinner size="xs" /> : <Square size={10} fill="currentColor" />}
              <Text fontSize="xs">Stop</Text>
            </HStack>
          )}
          <Box flex={1} />
          <RunMetricsSummary summary={summary} />
        </HStack>
      </Box>

      <Box padding={2}>
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
      </Box>

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
    </Box>
  );
}
