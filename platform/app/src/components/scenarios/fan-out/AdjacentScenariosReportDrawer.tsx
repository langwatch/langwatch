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
import { api } from "~/utils/api";
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

  const reportQuery = api.fanOut.report.useQuery(
    { projectId: project?.id ?? "", batchId: batchId ?? "" },
    {
      enabled: !!project?.id && !!batchId,
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
          {reportQuery.error ? (
            <HandledErrorAlert
              error={reportQuery.error}
              fallbackTitle="Couldn't load the blast radius"
            />
          ) : reportQuery.isLoading ? (
            <HStack justify="center" padding={10}>
              <Spinner size="sm" />
              <Text textStyle="sm" color="fg.muted">
                Loading
              </Text>
            </HStack>
          ) : !report ? (
            <Text textStyle="sm" color="fg.muted">
              No results yet.
            </Text>
          ) : (
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

              {lensRows.length > 0 && (
                <Box>
                  <Text textStyle="sm" fontWeight="medium" marginBottom={2}>
                    Where it breaks
                  </Text>
                  <VStack align="stretch" gap={2}>
                    {lensRows.map(([lens, counts]) => (
                      <HStack key={lens} justify="space-between">
                        <Text textStyle="sm">
                          {FAN_OUT_LENS_LABELS[lens] ?? lens}
                        </Text>
                        <Text
                          textStyle="sm"
                          color={counts.failed > 0 ? "red.500" : "fg.muted"}
                          fontWeight={counts.failed > 0 ? "medium" : "normal"}
                        >
                          {counts.failed} of {counts.total} failed
                        </Text>
                      </HStack>
                    ))}
                  </VStack>
                </Box>
              )}

              <Box>
                <Text textStyle="sm" fontWeight="medium" marginBottom={2}>
                  Each scenario
                </Text>
                <VStack align="stretch" gap={0}>
                  {report.variants.map((entry) => (
                    <HStack
                      key={entry.variant.id}
                      justify="space-between"
                      paddingY={3}
                      borderBottomWidth="1px"
                      borderColor="border.muted"
                    >
                      <VStack align="start" gap={1} flex={1} minWidth={0}>
                        <Badge size="sm" variant="subtle">
                          {FAN_OUT_LENS_LABELS[entry.variant.lens] ??
                            entry.variant.lens}
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
                  ))}
                </VStack>
              </Box>
            </VStack>
          )}
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
  const percent = finished > 0 ? Math.round((failed / finished) * 100) : 0;

  return (
    <Box
      borderWidth="1px"
      borderColor={failed > 0 ? "red.200" : "border.muted"}
      borderRadius="md"
      padding={4}
      bg={failed > 0 ? "red.50" : "bg.subtle"}
      _dark={{
        bg: failed > 0 ? "red.950" : "bg.subtle",
        borderColor: failed > 0 ? "red.800" : "border.muted",
      }}
    >
      <VStack align="start" gap={2}>
        <Heading size="lg" color={failed > 0 ? "red.600" : "fg"}>
          {failed} of {finished || total} also failed
        </Heading>
        <Text textStyle="sm" color="fg.muted">
          {failed === 0 && finished > 0
            ? "The problem looks contained to the case you started from."
            : failed > 0
              ? "The same problem shows up in scenarios next to the one you reported."
              : "Waiting for the first results."}
        </Text>
        {finished > 0 && (
          <Progress.Root
            value={percent}
            size="sm"
            width="full"
            colorPalette={failed > 0 ? "red" : "green"}
          >
            <Progress.Track>
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
        )}
        {stillRunning > 0 && (
          <HStack gap={2}>
            <Spinner size="xs" />
            <Text textStyle="xs" color="fg.muted">
              {stillRunning} still running
            </Text>
          </HStack>
        )}
      </VStack>
    </Box>
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
