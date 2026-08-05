import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Progress,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { HandledErrorAlert } from "~/features/errors";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { Drawer } from "../../ui/drawer";
import { FAN_OUT_LENS_LABELS } from "../services/fanOutGeneration";

interface Props {
  batchId?: string;
}

/**
 * Blast-radius report: how far the seed failure actually extends once the
 * approved variants have run.
 *
 * See specs/scenarios/adjacent-scenario-blast-radius.feature.
 */
export function AdjacentScenariosReportDrawerFromUrl(props: Props) {
  const params = useDrawerParams();
  return (
    <AdjacentScenariosReportDrawer
      {...props}
      batchId={props.batchId ?? params.batchId}
    />
  );
}

export function AdjacentScenariosReportDrawer({ batchId }: Props) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();

  const canQuery = !!project?.id && !!batchId;
  const reportQuery = api.fanOut.report.useQuery(
    { projectId: project?.id ?? "", batchId: batchId ?? "" },
    {
      enabled: canQuery,
      // Runs land asynchronously, so keep pulling until everything settles.
      refetchInterval: (data) =>
        data && data.finishedVariants < data.totalVariants ? 3000 : false,
    },
  );

  const report = reportQuery.data;
  const stillRunning = report
    ? report.totalVariants - report.finishedVariants
    : 0;

  const lensRows = useMemo(
    () => Object.entries(report?.byLens ?? {}),
    [report?.byLens],
  );

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="xl"
      onOpenChange={closeDrawer}
    >
      <Drawer.Content>
        <Drawer.Header borderBottomWidth="1px">
          <VStack align="start" gap={1}>
            <Heading size="md">Blast radius</Heading>
            <Text textStyle="sm" color="fg.muted">
              How far this failure reaches beyond the case you reported.
            </Text>
          </VStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>

        <Drawer.Body>
          <ReportBody
            error={reportQuery.error}
            loading={!canQuery || reportQuery.isLoading}
            report={report}
            stillRunning={stillRunning}
            lensRows={lensRows}
          />
        </Drawer.Body>

        <Drawer.Footer borderTopWidth="1px">
          <Button size="sm" variant="outline" onClick={closeDrawer}>
            Done
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

type ReportData = RouterOutputs["fanOut"]["report"];

/** The one place that decides between error, loading, empty and the report. */
function ReportBody({
  error,
  loading,
  report,
  stillRunning,
  lensRows,
}: {
  error: unknown;
  loading: boolean;
  report: ReportData | undefined;
  stillRunning: number;
  lensRows: [string, LensCounts][];
}) {
  if (error) {
    return (
      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't load the blast radius"
      />
    );
  }

  if (loading) {
    return (
      <HStack justify="center" padding={10}>
        <Spinner size="sm" />
        <Text textStyle="sm" color="fg.muted">
          Loading
        </Text>
      </HStack>
    );
  }

  if (!report) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No results yet.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={6}>
      <Headline
        failed={report.failedVariants}
        finished={report.finishedVariants}
        total={report.totalVariants}
        stillRunning={stillRunning}
      />

      {report.seedRun && (
        <Box>
          <Text textStyle="sm" fontWeight="medium" marginBottom={1}>
            The original failure
          </Text>
          <StatusBadge status={report.seedRun.status} />
        </Box>
      )}

      <LensBreakdown rows={lensRows} />

      <Box>
        <Text textStyle="sm" fontWeight="medium" marginBottom={2}>
          Each scenario
        </Text>
        <VStack align="stretch" gap={0}>
          {report.variants.map((entry) => (
            <VariantResultRow key={entry.variant.id} entry={entry} />
          ))}
        </VStack>
      </Box>
    </VStack>
  );
}

type LensCounts = { total: number; failed: number; finished: number };

/** Which adjacency lenses the failure reached, and how far into each. */
function LensBreakdown({ rows }: { rows: [string, LensCounts][] }) {
  if (rows.length === 0) return null;

  return (
    <Box>
      <Text textStyle="sm" fontWeight="medium" marginBottom={2}>
        Where it breaks
      </Text>
      <VStack align="stretch" gap={2}>
        {rows.map(([lens, counts]) => (
          <LensRow key={lens} lens={lens} counts={counts} />
        ))}
      </VStack>
    </Box>
  );
}

function LensRow({ lens, counts }: { lens: string; counts: LensCounts }) {
  const anyFailed = counts.failed > 0;

  return (
    <HStack justify="space-between">
      <Text textStyle="sm">{FAN_OUT_LENS_LABELS[lens] ?? lens}</Text>
      <Text
        textStyle="sm"
        color={anyFailed ? "red.500" : "fg.muted"}
        fontWeight={anyFailed ? "medium" : "normal"}
      >
        {counts.failed} of {counts.total} failed
      </Text>
    </HStack>
  );
}

function VariantResultRow({
  entry,
}: {
  entry: {
    variant: { lens: string; rationale: string | null };
    run: { status: string } | null;
  };
}) {
  return (
    <HStack
      justify="space-between"
      paddingY={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
    >
      <VStack align="start" gap={1} flex={1} minWidth={0}>
        <Badge size="sm" variant="subtle">
          {FAN_OUT_LENS_LABELS[entry.variant.lens] ?? entry.variant.lens}
        </Badge>
        {entry.variant.rationale && (
          <Text textStyle="xs" color="fg.muted">
            {entry.variant.rationale}
          </Text>
        )}
      </VStack>
      {entry.run ? (
        <StatusBadge status={entry.run.status} />
      ) : (
        <Badge size="sm" variant="subtle" colorPalette="gray">
          Waiting
        </Badge>
      )}
    </HStack>
  );
}

/** The sentence under the headline number. */
function summarize({
  failed,
  finished,
}: {
  failed: number;
  finished: number;
}): string {
  if (finished === 0) return "Waiting for the first results.";
  if (failed === 0)
    return "The problem looks contained to the case you started from.";
  return "The same problem shows up in scenarios next to the one you reported.";
}

function Headline({
  failed,
  finished,
  total,
  stillRunning,
}: {
  failed: number;
  finished: number;
  total: number;
  stillRunning: number;
}) {
  const anyFailed = failed > 0;
  const anyFinished = finished > 0;
  const percent = anyFinished ? Math.round((failed / finished) * 100) : 0;

  return (
    <Box
      borderWidth="1px"
      borderColor={anyFailed ? "red.200" : "border.muted"}
      borderRadius="md"
      padding={4}
      bg={anyFailed ? "red.50" : "bg.subtle"}
      _dark={{
        bg: anyFailed ? "red.950" : "bg.subtle",
        borderColor: anyFailed ? "red.800" : "border.muted",
      }}
    >
      <VStack align="start" gap={2}>
        <Heading size="lg" color={anyFailed ? "red.600" : "fg"}>
          {anyFinished
            ? `${failed} of ${finished} also failed`
            : `Waiting on ${total} scenarios`}
        </Heading>
        <Text textStyle="sm" color="fg.muted">
          {summarize({ failed, finished })}
        </Text>
        {anyFinished && (
          <Progress.Root
            value={percent}
            size="sm"
            width="full"
            colorPalette={anyFailed ? "red" : "green"}
          >
            <Progress.Track>
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
        )}
        {stillRunning > 0 && <StillRunning count={stillRunning} />}
      </VStack>
    </Box>
  );
}

function StillRunning({ count }: { count: number }) {
  return (
    <HStack gap={2}>
      <Spinner size="xs" />
      <Text textStyle="xs" color="fg.muted">
        {count} still running
      </Text>
    </HStack>
  );
}

function StatusBadge({ status }: { status: string }) {
  const failed =
    status === "FAILED" || status === "ERROR" || status === "CANCELLED";
  const passed = status === "SUCCESS";

  return (
    <Badge
      size="sm"
      variant="subtle"
      colorPalette={failed ? "red" : passed ? "green" : "gray"}
    >
      {failed ? "Failed" : passed ? "Passed" : "Running"}
    </Badge>
  );
}
