import {
  Badge,
  Card,
  Center,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  formatBytes,
  formatMs,
  formatTimeAgo,
} from "~/components/ops/shared/formatters";
import { Dialog } from "~/components/ui/dialog";
import { api } from "~/utils/api";
import {
  LANE_STATUS_COLORS,
  LANE_STATUS_LABELS,
  laneStatus,
} from "./laneFilters";

const EM_DASH = "—";

function Field({ label, children }: { label: string; children: string }) {
  return (
    <VStack align="start" gap={0}>
      <Text textStyle="xs" color="fg.muted">
        {label}
      </Text>
      <Text textStyle="sm" fontFamily="mono">
        {children}
      </Text>
    </VStack>
  );
}

export function LaneDetailDialog({
  lane,
  onClose,
}: {
  lane: { laneKind: string; laneId: string } | null;
  onClose: () => void;
}) {
  const detailQuery = api.ops.getLaneDetail.useQuery(
    { laneKind: lane?.laneKind ?? "", laneId: lane?.laneId ?? "" },
    { enabled: !!lane },
  );
  const jobsQuery = api.ops.getLaneJobs.useQuery(
    { laneId: lane?.laneId ?? "", page: 1, pageSize: 20 },
    { enabled: !!lane },
  );

  const detail = detailQuery.data;
  const jobs = jobsQuery.data;
  const status = detail ? laneStatus(detail) : null;

  return (
    <Dialog.Root
      open={!!lane}
      onOpenChange={(e) => !e.open && onClose()}
      size="lg"
    >
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>
            <Text textStyle="sm" fontFamily="mono" wordBreak="break-all">
              {lane?.laneId}
            </Text>
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {detailQuery.isLoading ? (
            <Center paddingY={6}>
              <Spinner size="sm" />
            </Center>
          ) : detail && status ? (
            <VStack align="stretch" gap={4}>
              <HStack gap={4} flexWrap="wrap">
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">
                    Status
                  </Text>
                  <Badge
                    size="sm"
                    variant="subtle"
                    colorPalette={LANE_STATUS_COLORS[status]}
                  >
                    {LANE_STATUS_LABELS[status]}
                  </Badge>
                </VStack>
                <Field label="Tenant">{detail.tenantId}</Field>
                <Field label="Kind">{detail.laneKind}</Field>
                <Field label="Name">{detail.laneName ?? EM_DASH}</Field>
                <Field label="Pending">{detail.pendingJobs.toString()}</Field>
                <Field label="Attempts">{detail.attempts.toString()}</Field>
              </HStack>

              <HStack gap={4} flexWrap="wrap">
                <Field label="Lease left">
                  {detail.leaseRemainingMs === null
                    ? EM_DASH
                    : formatMs(detail.leaseRemainingMs)}
                </Field>
                <Field label="Retries at">
                  {formatTimeAgo(detail.readyAtMs)}
                </Field>
                <Field label="Head ordering key">
                  {detail.headOrderingKey === null
                    ? EM_DASH
                    : detail.headOrderingKey.toString()}
                </Field>
              </HStack>

              {detail.parkReason && (
                <VStack align="stretch" gap={1}>
                  <Text textStyle="xs" color="fg.muted">
                    Park reason
                  </Text>
                  <Card.Root borderColor="red.500/20">
                    <Card.Body padding={3}>
                      <Text
                        textStyle="xs"
                        color="red.500"
                        whiteSpace="pre-wrap"
                        wordBreak="break-word"
                      >
                        {detail.parkReason}
                      </Text>
                    </Card.Body>
                  </Card.Root>
                </VStack>
              )}

              <VStack align="stretch" gap={1}>
                <Text textStyle="xs" color="fg.muted">
                  Staged jobs {jobs ? `(${jobs.total})` : ""}
                </Text>
                {jobsQuery.isLoading ? (
                  <Spinner size="xs" />
                ) : jobs && jobs.jobs.length > 0 ? (
                  <Table.ScrollArea maxHeight="320px">
                    <Table.Root size="sm" variant="line">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader width="50px">
                            Seq
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>Event</Table.ColumnHeader>
                          <Table.ColumnHeader>Aggregate</Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end" width="55px">
                            Try
                          </Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end" width="80px">
                            Body
                          </Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {jobs.jobs.map((job) => (
                          <Table.Row key={job.eventId}>
                            <Table.Cell>
                              <Text textStyle="xs" fontFamily="mono">
                                {job.sequence}
                              </Text>
                            </Table.Cell>
                            <Table.Cell>
                              <Text
                                textStyle="xs"
                                truncate
                                maxWidth="200px"
                                title={job.eventType}
                              >
                                {job.eventType}
                              </Text>
                            </Table.Cell>
                            <Table.Cell>
                              <Text
                                textStyle="xs"
                                fontFamily="mono"
                                truncate
                                maxWidth="180px"
                                title={job.aggregateId}
                              >
                                {job.aggregateId}
                              </Text>
                            </Table.Cell>
                            <Table.Cell textAlign="end">
                              <Text
                                textStyle="xs"
                                fontFamily="mono"
                                color={
                                  job.attempt > 0 ? "orange.500" : "fg.muted"
                                }
                              >
                                {job.attempt}
                              </Text>
                            </Table.Cell>
                            <Table.Cell textAlign="end">
                              <Text textStyle="xs" color="fg.muted">
                                {job.blobRef
                                  ? "spooled"
                                  : formatBytes(job.costBytes)}
                              </Text>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Table.ScrollArea>
                ) : (
                  <Text textStyle="xs" color="fg.muted">
                    Nothing staged on this lane.
                  </Text>
                )}
              </VStack>
            </VStack>
          ) : null}
        </Dialog.Body>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
