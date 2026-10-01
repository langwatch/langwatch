import { Box, Button, HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { differenceInMinutes, differenceInSeconds, toEpochMs } from "@langwatch/time";

import { api, type RouterOutputs } from "../../../../behavior/automation-api.ts";
import { formatTimeAgo } from "../../../../model/relative-time.ts";
import {
  describeEvaluation,
  type RecordedEvaluation,
} from "../../model/evaluation-presentation.ts";

type TriggerFire = RouterOutputs["automation"]["getFireHistory"]["fires"][number];

const FIRE_PAGE_SIZE = 20;

const TONE_DOT: Record<string, string> = {
  fired: "red.solid",
  quiet: "green.solid",
  attention: "orange.solid",
};

interface HistorySectionProps {
  automationId: string;
  projectId: string;
  isGraphAlert: boolean;
  /** Whether the drawer also offers to run the conditions now; the empty state points at it. */
  canRunConditions: boolean;
  /** No condition at all: the empty state must not promise it filters. */
  isUnconditioned?: boolean;
  /** A report sends on its schedule, so its empty state never mentions traces. */
  isReport?: boolean;
}

/*
 * Everything this automation has done, newest first: an alert's last check and every fire. Fires
 * sharing a relative-time label collapse into one "Fired 7 times" row; alerts stay per-incident.
 */
export function HistorySection({
  automationId,
  projectId,
  isGraphAlert,
  canRunConditions,
  isUnconditioned = false,
  isReport = false,
}: HistorySectionProps) {
  const historyQuery = api.automation.getFireHistory.useInfiniteQuery(
    { projectId, triggerId: automationId, limit: FIRE_PAGE_SIZE },
    {
      enabled: !!projectId,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  // Only an alert is evaluated against a threshold, so only an alert asks.
  const wantsEvaluation = !!projectId && isGraphAlert;
  const evaluationQuery = api.automation.getLatestEvaluation.useQuery(
    { projectId, triggerId: automationId },
    { enabled: wantsEvaluation },
  );

  const fires = (historyQuery.data?.pages ?? []).flatMap((page) => page.fires);
  const evaluation = evaluationQuery.data ?? undefined;
  // A disabled query reports `isLoading` forever, so the evaluation read only
  // counts towards the skeleton when it is actually enabled.
  const isLoading = historyQuery.isLoading || (wantsEvaluation && evaluationQuery.isLoading);
  const isError = historyQuery.isError || (wantsEvaluation && evaluationQuery.isError);

  return (
    <VStack align="start" gap={2} width="full">
      <Text textStyle="xs" color="fg.muted" fontWeight="medium">
        History
      </Text>
      <HistoryBody
        isLoading={isLoading}
        isError={isError}
        fires={fires}
        evaluation={evaluation}
        isGraphAlert={isGraphAlert}
        canRunConditions={canRunConditions}
        isUnconditioned={isUnconditioned}
        isReport={isReport}
      />
      {historyQuery.hasNextPage ? (
        <Button
          size="xs"
          variant="ghost"
          loading={historyQuery.isFetchingNextPage}
          onClick={() => void historyQuery.fetchNextPage()}
        >
          Show earlier
        </Button>
      ) : null}
    </VStack>
  );
}

/** The check and the fires as one list, newest first. */
function Timeline({
  fires,
  evaluation,
  isGraphAlert,
}: {
  fires: TriggerFire[];
  evaluation: RecordedEvaluation | undefined;
  isGraphAlert: boolean;
}) {
  return (
    <VStack
      align="stretch"
      gap={0}
      width="full"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
    >
      {evaluation ? <EvaluationRow evaluation={evaluation} /> : null}
      {fireRows({ fires, isGraphAlert }).map((row) => (
        <TimelineRow
          key={row.key}
          dot={row.dot}
          label={row.label}
          detail={row.detail}
          detailColor={row.detailColor}
        />
      ))}
    </VStack>
  );
}

/** The alert's last check, beside the fires it explains the absence of. */
function EvaluationRow({ evaluation }: { evaluation: RecordedEvaluation }) {
  const presentation = describeEvaluation(evaluation);

  return (
    <Box
      borderBottomWidth="1px"
      borderColor="border"
      _last={{ borderBottomWidth: 0 }}
      paddingX={3}
      paddingY={2}
    >
      <HStack gap={2.5}>
        <Box
          boxSize={2}
          borderRadius="full"
          flexShrink={0}
          bg={TONE_DOT[presentation.tone] ?? "gray.solid"}
        />
        <Text textStyle="sm" flex="1" minWidth="0">
          Checked · {presentation.outcome}
        </Text>
        <Text textStyle="xs" color="fg.muted" flexShrink={0} whiteSpace="nowrap">
          {formatTimeAgo(toEpochMs(evaluation.evaluatedAt))}
        </Text>
      </HStack>
      {/* The two numbers are the point of the row, never behind a click. */}
      <VStack align="stretch" gap={0.5} paddingLeft={4.5} paddingTop={1}>
        {presentation.observation ? (
          <Text textStyle="xs" color="fg.muted">
            {presentation.observation}
          </Text>
        ) : null}
        {presentation.explanation ? (
          <Text textStyle="xs" color="fg.muted">
            {presentation.explanation}
          </Text>
        ) : null}
      </VStack>
    </Box>
  );
}

function TimelineRow({ dot, label, detail, detailColor }: Omit<FireRow, "key">) {
  return (
    <HStack
      gap={2.5}
      paddingX={3}
      paddingY={2}
      borderBottomWidth="1px"
      borderColor="border"
      _last={{ borderBottomWidth: 0 }}
    >
      <Box boxSize={2} borderRadius="full" flexShrink={0} bg={dot} />
      <Text textStyle="sm" flex="1" minWidth="0">
        {label}
      </Text>
      <Text textStyle="xs" color={detailColor} flexShrink={0} whiteSpace="nowrap">
        {detail}
      </Text>
    </HStack>
  );
}

/** Loading, a failed read, nothing yet, or the timeline: in that order. */
function HistoryBody({
  isLoading,
  isError,
  fires,
  evaluation,
  isGraphAlert,
  canRunConditions,
  isUnconditioned,
  isReport,
}: {
  isLoading: boolean;
  isError: boolean;
  fires: TriggerFire[];
  evaluation: RecordedEvaluation | undefined;
  isGraphAlert: boolean;
  canRunConditions: boolean;
  isUnconditioned: boolean;
  isReport: boolean;
}) {
  if (isLoading) return <Skeleton height="60px" width="full" />;
  if (isError) {
    return (
      <Text textStyle="sm" color="fg.muted">
        {"Couldn't load this automation's history."}
      </Text>
    );
  }
  if (fires.length === 0 && !evaluation) {
    return (
      <Text textStyle="sm" color="fg.muted">
        {emptyHistoryCopy({ isGraphAlert, canRunConditions, isUnconditioned, isReport })}
      </Text>
    );
  }
  return <Timeline fires={fires} evaluation={evaluation} isGraphAlert={isGraphAlert} />;
}

function emptyHistoryCopy({
  isGraphAlert,
  canRunConditions,
  isUnconditioned,
  isReport,
}: {
  isGraphAlert: boolean;
  canRunConditions: boolean;
  isUnconditioned: boolean;
  isReport: boolean;
}): string {
  if (isReport) return "This report has not been sent yet. It sends on its schedule.";
  if (isGraphAlert) {
    return "This automation has not fired yet, and has not been checked yet either. It is checked as data arrives for the graph it watches.";
  }
  if (isUnconditioned) {
    return "This automation has not fired yet. It has no condition, so it will act on every trace that arrives.";
  }
  const hint = canRunConditions ? ": run them against recent traces to see what would match." : ".";
  return `This automation has not fired yet. It only acts on traces that match its conditions${hint}`;
}

interface FireRow {
  key: string;
  dot: string;
  label: string;
  detail: string;
  detailColor: string;
}

function fireRows({
  fires,
  isGraphAlert,
}: {
  fires: TriggerFire[];
  isGraphAlert: boolean;
}): FireRow[] {
  if (isGraphAlert) return fires.map(incidentRow);
  return groupFiresByLabel(fires).map((group) => ({
    key: group.key,
    dot: "green.solid",
    label: group.count === 1 ? "Fired once" : `Fired ${group.count} times`,
    detail: group.label,
    detailColor: "fg.muted",
  }));
}

/** One graph-alert incident: when it opened, and how long it stayed open. */
function incidentRow(fire: TriggerFire): FireRow {
  if (!fire.resolvedAt) {
    return {
      key: fire.id,
      dot: "red.solid",
      label: "Firing",
      detail: "still firing",
      detailColor: "red.fg",
    };
  }
  const firedAt = toEpochMs(fire.createdAt);
  const lasted = formatDurationBetween({ from: firedAt, to: toEpochMs(fire.resolvedAt) });
  return {
    key: fire.id,
    dot: "green.solid",
    label: "Resolved",
    detail: `${formatTimeAgo(firedAt)} · lasted ${lasted}`,
    detailColor: "fg.muted",
  };
}

/** Collapse consecutive fires sharing a relative-time label; input is newest-first. */
function groupFiresByLabel(fires: TriggerFire[]): { key: string; label: string; count: number }[] {
  const groups: { key: string; label: string; count: number }[] = [];
  for (const fire of fires) {
    const label = formatTimeAgo(toEpochMs(fire.createdAt)) ?? "";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.count++;
    else groups.push({ key: fire.id, label, count: 1 });
  }
  return groups;
}

/** How long an incident stayed open, spelled out; sub-minute shows seconds. */
export function formatDurationBetween({ from, to }: { from: number; to: number }): string {
  const minutes = differenceInMinutes(to, from);
  if (minutes < 1) {
    return plural({ count: Math.max(differenceInSeconds(to, from), 1), unit: "second" });
  }
  if (minutes < 60) return plural({ count: minutes, unit: "minute" });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0
    ? `${plural({ count: hours, unit: "hour" })} ${plural({ count: rest, unit: "minute" })}`
    : plural({ count: hours, unit: "hour" });
}

function plural({ count, unit }: { count: number; unit: string }): string {
  return `${count} ${count === 1 ? unit : `${unit}s`}`;
}
