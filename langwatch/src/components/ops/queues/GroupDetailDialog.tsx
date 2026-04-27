import {
  Badge,
  Box,
  Card,
  Center,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Dialog } from "~/components/ui/dialog";
import { formatTimeAgo } from "~/components/ops/shared/formatters";
import { api } from "~/utils/api";

export function GroupDetailDialog({
  group,
  onClose,
}: {
  group: { queueName: string; groupId: string } | null;
  onClose: () => void;
}) {
  const detailQuery = api.ops.getGroupDetail.useQuery(
    { queueName: group?.queueName ?? "", groupId: group?.groupId ?? "" },
    { enabled: !!group },
  );
  const jobsQuery = api.ops.getGroupJobs.useQuery(
    { queueName: group?.queueName ?? "", groupId: group?.groupId ?? "", page: 1, pageSize: 20 },
    { enabled: !!group },
  );

  const detail = detailQuery.data;
  const jobs = jobsQuery.data;

  return (
    <Dialog.Root open={!!group} onOpenChange={(e) => !e.open && onClose()} size="lg">
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            <Text textStyle="sm" fontFamily="mono" wordBreak="break-all">{group?.groupId}</Text>
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {detailQuery.isLoading ? (
            <Center paddingY={6}><Spinner size="sm" /></Center>
          ) : detail ? (
            <VStack align="stretch" gap={4}>
              {/* Status row */}
              <HStack gap={4} flexWrap="wrap">
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Status</Text>
                  {detail.isStaleBlock ? (
                    <Badge size="sm" colorPalette="orange" variant="subtle">Stale</Badge>
                  ) : detail.isBlocked ? (
                    <Badge size="sm" colorPalette="red" variant="subtle">Blocked</Badge>
                  ) : detail.hasActiveJob ? (
                    <Badge size="sm" colorPalette="green" variant="subtle">Active</Badge>
                  ) : (
                    <Badge size="sm" colorPalette="gray" variant="subtle">OK</Badge>
                  )}
                </VStack>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Pipeline</Text>
                  <Text textStyle="sm">{detail.pipelineName ?? "\u2014"}</Text>
                </VStack>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Pending</Text>
                  <Text textStyle="sm" fontFamily="mono">{detail.pendingJobs}</Text>
                </VStack>
                {(detail.retryCount ?? 0) > 0 && (
                  <VStack align="start" gap={0}>
                    <Text textStyle="xs" color="fg.muted">Retries</Text>
                    <Text textStyle="sm" fontFamily="mono" color="orange.500">{detail.retryCount}</Text>
                  </VStack>
                )}
                {detail.activeJobId && (
                  <VStack align="start" gap={0}>
                    <Text textStyle="xs" color="fg.muted">Active Job</Text>
                    <Text textStyle="xs" fontFamily="mono" color="green.500">{detail.activeJobId}</Text>
                  </VStack>
                )}
              </HStack>

              {/* Timestamps */}
              <HStack gap={4}>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Oldest Job</Text>
                  <Text textStyle="sm">{formatTimeAgo(detail.oldestJobMs)}</Text>
                </VStack>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Newest Job</Text>
                  <Text textStyle="sm">{formatTimeAgo(detail.newestJobMs)}</Text>
                </VStack>
                {detail.processingDurationMs != null && (
                  <VStack align="start" gap={0}>
                    <Text textStyle="xs" color="fg.muted">Processing</Text>
                    <Text textStyle="sm">{detail.processingDurationMs}ms</Text>
                  </VStack>
                )}
              </HStack>

              {/* Error info */}
              {detail.errorMessage && (
                <VStack align="stretch" gap={1}>
                  <Text textStyle="xs" color="fg.muted">Error</Text>
                  <Card.Root borderColor="red.500/20">
                    <Card.Body padding={3}>
                      <Text textStyle="xs" color="red.500" whiteSpace="pre-wrap" wordBreak="break-word">
                        {detail.errorMessage}
                      </Text>
                      {detail.errorStack && (
                        <Box marginTop={2} maxHeight="200px" overflow="auto" bg="bg.subtle" borderRadius="sm" padding={2}>
                          <Text textStyle="xs" fontFamily="mono" color="fg.muted" whiteSpace="pre" fontSize="10px">
                            {detail.errorStack}
                          </Text>
                        </Box>
                      )}
                    </Card.Body>
                  </Card.Root>
                </VStack>
              )}

              {/* Jobs list */}
              <VStack align="stretch" gap={1}>
                <Text textStyle="xs" color="fg.muted">
                  Jobs {jobs ? `(${jobs.total})` : ""}
                </Text>
                {jobsQuery.isLoading ? (
                  <Spinner size="xs" />
                ) : jobs && jobs.jobs.length > 0 ? (
                  <VStack align="stretch" gap={2}>
                    {jobs.jobs.map((job) => (
                      <Card.Root key={job.jobId} variant="outline">
                        <Card.Body padding={3}>
                          <HStack gap={3} marginBottom={job.data ? 2 : 0}>
                            <VStack align="start" gap={0}>
                              <Text textStyle="xs" color="fg.muted">Job ID</Text>
                              <Text textStyle="xs" fontFamily="mono" wordBreak="break-all">{job.jobId}</Text>
                            </VStack>
                            <VStack align="start" gap={0}>
                              <Text textStyle="xs" color="fg.muted">Score</Text>
                              <Text textStyle="xs" fontFamily="mono">{job.score}</Text>
                            </VStack>
                          </HStack>
                          {job.data && (
                            <Box bg="bg.subtle" borderRadius="sm" padding={2} maxHeight="200px" overflow="auto">
                              <Text as="pre" textStyle="xs" fontFamily="mono" whiteSpace="pre-wrap" wordBreak="break-word" fontSize="11px">
                                {JSON.stringify(job.data, null, 2)}
                              </Text>
                            </Box>
                          )}
                        </Card.Body>
                      </Card.Root>
                    ))}
                  </VStack>
                ) : (
                  <Text textStyle="xs" color="fg.muted">No jobs in queue.</Text>
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
