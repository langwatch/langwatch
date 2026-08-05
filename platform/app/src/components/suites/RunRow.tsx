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
import {
  ChevronDown,
  ChevronRight,
  FileText,
  MoreVertical,
  Square,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { useNow } from "~/hooks/useNow";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { RunMetricsSummary } from "./RunMetricsSummary";
import type { BatchRun, BatchRunSummary } from "./run-history-transforms";
import { computeIterationMap } from "./run-history-transforms";
import { ScenarioRunContent } from "./ScenarioRunContent";
import { isCancellableStatus } from "./useCancelScenarioRun";
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
  /** Produces the run report for this batch. Absent when it cannot be scoped. */
  onExportReport?: () => void;
  /** Export with Langy's written analysis, which takes a minute or two. */
  onExportReportWithLangy?: () => void;
  /** Stops the report currently being produced for this batch. */
  onCancelReport?: () => void;
  /** Whether a report is being produced for THIS batch, not for any other. */
  isReportRunning?: boolean;
  /** Which stage the report is in, so the wait says what it is doing. */
  reportStage?: string | null;
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
      <Box
        padding={2}
        paddingBottom={0}
        width="full"
        position="sticky"
        top={0}
        zIndex={20}
      >
        <HStack
          width="full"
          paddingX={4}
          paddingY={3}
          gap={3}
          flexWrap="nowrap"
          bg="color-mix(in srgb, var(--chakra-colors-bg-panel) var(--lw-panel-alpha, 70%), transparent)"
          backdropFilter="var(--lw-backdrop-blur, blur(12px) saturate(140%))"
          borderWidth="1px"
          borderColor="border.muted"
          data-testid="run-row-header"
          borderRadius="lg"
          boxShadow="xs"
        >
          <Spinner
            size="xs"
            color="fg.muted"
            css={{ flexShrink: 0, height: "14px", width: "14px" }}
          />
          {suiteName && (
            <>
              <Text
                fontSize="sm"
                fontWeight="medium"
                color="fg.default"
                flexShrink={0}
              >
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
          {/* Invisible spacer matching RunMetricsSummary pill height */}
          <Box
            paddingY={1}
            paddingX={2}
            borderRadius="lg"
            border="1px solid transparent"
          >
            <Text fontSize="12px" visibility="hidden">
              &nbsp;
            </Text>
          </Box>
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
  onExportReport,
  onExportReportWithLangy,
  onCancelReport,
  isReportRunning = false,
  reportStage = null,
}: RunRowDataProps) {
  const [isCancelAllDialogOpen, setIsCancelAllDialogOpen] = useState(false);
  const now = useNow();
  const timeAgo = formatTimeAgoCompact(batchRun.timestamp, now);

  const iterationMap = useMemo(
    () => computeIterationMap({ scenarioRuns: batchRun.scenarioRuns }),
    [batchRun.scenarioRuns],
  );

  const cancellableCount = useMemo(
    () =>
      batchRun.scenarioRuns.filter((run) => isCancellableStatus(run.status))
        .length,
    [batchRun.scenarioRuns],
  );
  const hasCancellableRuns = cancellableCount > 0;

  return (
    <Box
      data-batch-id={batchRun.batchRunId}
      css={
        isHighlighted
          ? {
              "@keyframes yellowFlash": {
                "0%": { backgroundColor: "rgba(234, 179, 8, 0.3)" },
                "100%": { backgroundColor: "transparent" },
              },
              animation: "yellowFlash 2s ease-out",
            }
          : undefined
      }
    >
      {/* Run header - clickable to expand/collapse, sticky within scroll container */}
      <Box
        padding={2}
        paddingBottom={0}
        width="full"
        position="sticky"
        top={0}
        zIndex={20}
      >
        {/* The row itself is a container rather than a button. It carries the
            Stop chips and the actions menu, which are controls of their own,
            and a control nested inside a button is invalid HTML that assistive
            technology flattens away. Expanding has its own button; clicking
            anywhere else on the row reaches the same handler by bubbling. */}
        <HStack
          width="full"
          paddingX={4}
          paddingY={3}
          gap={3}
          flexWrap="nowrap"
          cursor="pointer"
          onClick={onToggle}
          className="group"
          bg="color-mix(in srgb, var(--chakra-colors-bg-panel) var(--lw-panel-alpha, 70%), transparent)"
          backdropFilter="var(--lw-backdrop-blur, blur(12px) saturate(140%))"
          borderWidth="1px"
          borderColor="border.muted"
          transition="border-color 0.15s ease"
          _hover={{ borderColor: "border.emphasized" }}
          data-testid="run-row-header"
          borderRadius="lg"
          boxShadow="xs"
        >
          {/* No handler of its own: the click it fires bubbles to the row, so
              expanding happens in exactly one place however it was asked for. */}
          <HStack
            as="button"
            gap={3}
            flexShrink={0}
            cursor="pointer"
            aria-expanded={isExpanded}
            aria-label={`Run from ${timeAgo ?? "unknown time"}`}
            data-testid="run-row-toggle"
          >
            {isExpanded ? (
              <ChevronDown size={14} style={{ flexShrink: 0 }} />
            ) : (
              <ChevronRight size={14} style={{ flexShrink: 0 }} />
            )}
            {suiteName && (
              <>
                <Text
                  fontSize="sm"
                  fontWeight="medium"
                  color="fg.default"
                  flexShrink={0}
                >
                  {suiteName}
                </Text>
                <Text fontSize="sm" color="fg.muted" flexShrink={0}>
                  &middot;
                </Text>
              </>
            )}
            <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
              {timeAgo}
            </Text>
            {expectedJobCount != null &&
              summary.totalCount < expectedJobCount && (
                <Text fontSize="xs" color="fg.muted" flexShrink={0}>
                  {summary.totalCount} of {expectedJobCount}
                </Text>
              )}
          </HStack>
          {onCancelAll && hasCancellableRuns && (
            <HStack
              as="button"
              tabIndex={isCancellingBatch ? -1 : 0}
              gap={1}
              paddingX={2}
              paddingY={0.5}
              borderRadius="md"
              border="1px solid"
              borderColor="border"
              fontSize="xs"
              color="fg"
              cursor={isCancellingBatch ? "default" : "pointer"}
              flexShrink={0}
              opacity={isCancellingBatch ? 0.6 : 1}
              _hover={
                isCancellingBatch
                  ? undefined
                  : { bg: "bg.muted", borderColor: "border.emphasized" }
              }
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (!isCancellingBatch) setIsCancelAllDialogOpen(true);
              }}
              aria-label="Stop all remaining runs"
              aria-disabled={isCancellingBatch}
              data-testid="cancel-all-button"
            >
              {isCancellingBatch ? <Spinner size="xs" /> : <Square size={10} />}
              <Text fontSize="xs">Stop</Text>
            </HStack>
          )}
          {/* Transient, like the Stop chip beside it: it exists only while a
              report is being produced, and it is how that one is stopped. */}
          {isReportRunning && onCancelReport && (
            <HStack
              as="button"
              gap={1}
              paddingX={2}
              paddingY={0.5}
              borderRadius="md"
              border="1px solid"
              borderColor="border"
              fontSize="xs"
              color="fg"
              cursor="pointer"
              flexShrink={0}
              _hover={{ bg: "bg.muted", borderColor: "border.emphasized" }}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onCancelReport();
              }}
              aria-label="Cancel report"
              data-testid="cancel-report-button"
            >
              <Spinner size="xs" />
              <Text fontSize="xs">{reportStage ?? "Report"}</Text>
            </HStack>
          )}
          <Box flex={1} />
          <RunMetricsSummary summary={summary} />
          {/* Row actions live in one overflow menu (row-actions-overflow-menu.md).
              Opening it is not expanding the row, so the click stops here. */}
          {onExportReport && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Box
                  as="button"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  padding={1}
                  borderRadius="md"
                  color="fg.muted"
                  cursor="pointer"
                  flexShrink={0}
                  _hover={{ bg: "bg.muted", color: "fg" }}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  aria-label={`Actions for ${suiteName ?? "this run"}`}
                  data-testid="run-row-actions-button"
                >
                  <MoreVertical size={14} />
                </Box>
              </Menu.Trigger>
              <Menu.Content>
                {/* Instant first. Everything except Langy computes in under a
                    millisecond, so most exports should not be paying a minute
                    for a paragraph nobody asked for — and the computed report
                    is a whole document, not a degraded one. */}
                <Menu.Item
                  value="export-report"
                  disabled={isReportRunning}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (isReportRunning) return;
                    onExportReport();
                  }}
                  data-testid="export-report-menu-item"
                >
                  <Zap size={14} />
                  <Text>Instant export</Text>
                  <Box flex={1} />
                  {/* The size of the job is on the menu item, not in a toast
                      after the click. */}
                  <Text fontSize="xs" color="fg.muted">
                    {summary.totalCount}{" "}
                    {summary.totalCount === 1 ? "scenario" : "scenarios"}
                  </Text>
                </Menu.Item>
                {onExportReportWithLangy && (
                  <Menu.Item
                    value="export-report-langy"
                    disabled={isReportRunning}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (isReportRunning) return;
                      onExportReportWithLangy();
                    }}
                    data-testid="export-report-langy-menu-item"
                  >
                    <FileText size={14} />
                    <Text>Export with Langy</Text>
                    <Box flex={1} />
                    {/* Said before the click, because it is the whole
                        difference between the two items. */}
                    <Text fontSize="xs" color="fg.muted">
                      a minute or two
                    </Text>
                  </Menu.Item>
                )}
              </Menu.Content>
            </Menu.Root>
          )}
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
          <Dialog.Content bg="bg" maxWidth="sm">
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
                Cancel {cancellableCount}{" "}
                {cancellableCount === 1 ? "job" : "jobs"}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </Box>
  );
}
