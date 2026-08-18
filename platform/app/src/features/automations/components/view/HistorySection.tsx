import { Box, Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { differenceInMinutes, differenceInSeconds } from "date-fns";
import { api, type RouterOutputs } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import {
  describeEvaluation,
  type RecordedEvaluation,
} from "./evaluationPresentation";

type TriggerFire =
  RouterOutputs["automation"]["getFireHistory"]["fires"][number];

const FIRE_PAGE_SIZE = 20;

const TONE_DOT: Record<string, string> = {
  fired: "red.solid",
  quiet: "green.solid",
  attention: "orange.solid",
};

/**
 * Everything this automation has done, newest first: the last check of an
 * alert, and every time it fired.
 *
 * The fire ledger is metadata-only (no trace ids: `triggers:view` is weaker
 * than trace-content permission), so there is nothing per-trace to link. A
 * busy automation logs many rows that otherwise read as identical "fired 6
 * minutes ago" lines, so a run of fires sharing a relative-time label
 * collapses into one "Fired 7 times" row. Alerts stay per-incident, because
 * each open and each recovery is a distinct event a reader cares about.
 */
export function HistorySection({
  automationId,
  projectId,
  isGraphAlert,
  canRunConditions,
}: {
  automationId: string;
  projectId: string;
  isGraphAlert: boolean;
  /** Whether the drawer is also offering to run the conditions now — the
   *  empty state points at that control only when it exists. */
  canRunConditions: boolean;
}) {
  const historyQuery = api.automation.getFireHistory.useInfiniteQuery(
    { projectId, triggerId: automationId, limit: FIRE_PAGE_SIZE },
    {
      enabled: !!projectId,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );
  // Only an alert is evaluated against a threshold, so only an alert asks.
  const wantsEvaluation = !!projectId && isGraphAlert;
  const evaluationQuery = api.automation.getLatestEvaluation.useQuery(
    { projectId, triggerId: automationId },
    { enabled: wantsEvaluation },
  );

  const fires = (historyQuery.data?.pages ?? []).flatMap((page) => page.fires);
  const evaluation = evaluationQuery.data ?? null;
  // A disabled query reports `isLoading` forever — it has no data and never
  // will — so the evaluation read only counts towards the skeleton when it is
  // actually enabled. Without the gate every trace automation and every
  // schedule sat under a permanent skeleton and never showed its history.
  const isLoading =
    historyQuery.isLoading || (wantsEvaluation && evaluationQuery.isLoading);

  return (
    <VStack align="start" gap={2} width="full">
      <Text textStyle="xs" color="fg.muted" fontWeight="medium">
        History
      </Text>
      {isLoading ? (
        <Skeleton height="60px" width="full" />
      ) : fires.length === 0 && !evaluation ? (
        <EmptyHistory
          isGraphAlert={isGraphAlert}
          canRunConditions={canRunConditions}
        />
      ) : (
        <Timeline
          fires={fires}
          evaluation={evaluation}
          isGraphAlert={isGraphAlert}
        />
      )}
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
  evaluation: RecordedEvaluation | null;
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

/**
 * The last check of an alert, on the same timeline as its fires — because
 * "it was checked 5 minutes ago and the value was nowhere near the threshold"
 * is the answer to "why has this not fired?", and it belongs next to the
 * fires it explains the absence of.
 */
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
        <Text
          textStyle="xs"
          color="fg.muted"
          flexShrink={0}
          whiteSpace="nowrap"
        >
          {formatTimeAgo(new Date(evaluation.evaluatedAt).getTime())}
        </Text>
      </HStack>
      {/* The two numbers are the whole point of the row — never behind a
          click. A skip's explanation sits with them for the same reason. */}
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

function TimelineRow({
  dot,
  label,
  detail,
  detailColor,
}: {
  dot: string;
  label: string;
  detail: string;
  detailColor: string;
}) {
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
      <Text
        textStyle="xs"
        color={detailColor}
        flexShrink={0}
        whiteSpace="nowrap"
      >
        {detail}
      </Text>
    </HStack>
  );
}

function EmptyHistory({
  isGraphAlert,
  canRunConditions,
}: {
  isGraphAlert: boolean;
  canRunConditions: boolean;
}) {
  if (isGraphAlert) {
    return (
      <Text textStyle="sm" color="fg.muted">
        This automation has not fired yet, and has not been checked yet either.
        It is checked as data arrives for the graph it watches.
      </Text>
    );
  }
  return (
    <Text textStyle="sm" color="fg.muted">
      This automation has not fired yet. It only acts on traces that match its
      conditions
      {canRunConditions
        ? " — run them against recent traces to see what would match."
        : "."}
    </Text>
  );
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
  const firedAt = new Date(fire.createdAt);
  const resolvedAt = fire.resolvedAt ? new Date(fire.resolvedAt) : null;
  if (!resolvedAt) {
    return {
      key: fire.id,
      dot: "red.solid",
      label: "Firing",
      detail: "still firing",
      detailColor: "red.fg",
    };
  }
  return {
    key: fire.id,
    dot: "green.solid",
    label: "Resolved",
    detail: `${formatTimeAgo(firedAt.getTime())} · lasted ${formatDurationBetween(
      {
        from: firedAt,
        to: resolvedAt,
      },
    )}`,
    detailColor: "fg.muted",
  };
}

/** Collapse consecutive fires that share a relative-time label ("6 minutes
 *  ago") into one counted row. Input is newest-first, so equal labels are
 *  always adjacent. */
function groupFiresByLabel(
  fires: TriggerFire[],
): { key: string; label: string; count: number }[] {
  const groups: { key: string; label: string; count: number }[] = [];
  for (const fire of fires) {
    const label = formatTimeAgo(new Date(fire.createdAt).getTime()) ?? "";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.count++;
    else groups.push({ key: fire.id, label, count: 1 });
  }
  return groups;
}

/**
 * How long an incident stayed open ("lasted 15 minutes"). Spelled out, never
 * abbreviated — a saved pixel is not worth a guess. Sub-minute incidents show
 * seconds so a fast recovery doesn't read as "lasted 0 minutes".
 */
export function formatDurationBetween({
  from,
  to,
}: {
  from: Date;
  to: Date;
}): string {
  const minutes = differenceInMinutes(to, from);
  if (minutes < 1) {
    const seconds = Math.max(differenceInSeconds(to, from), 1);
    return plural({ count: seconds, unit: "second" });
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
