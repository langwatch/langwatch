import {
  Badge,
  Box,
  Button,
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
import { STATE_COLOR, STATE_LABEL } from "./pendingJobState";

export function PendingJobDetailDialog({
  target,
  queueName,
  onClose,
  onOpenGroup,
}: {
  target: { groupId: string; jobId: string } | null;
  queueName: string;
  onClose: () => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const detail = api.ops.getPendingJobDetail.useQuery(
    {
      queueName,
      groupId: target?.groupId ?? "",
      jobId: target?.jobId ?? "",
    },
    { enabled: !!target },
  );

  const data = detail.data;

  return (
    <Dialog.Root open={!!target} onOpenChange={(e) => !e.open && onClose()} size="lg">
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            <Text textStyle="sm" fontFamily="mono" wordBreak="break-all">{target?.jobId}</Text>
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {detail.isLoading ? (
            <Center paddingY={6}><Spinner size="sm" /></Center>
          ) : data ? (
            <VStack align="stretch" gap={4}>
              <HStack gap={4} flexWrap="wrap">
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">State</Text>
                  <Badge size="sm" colorPalette={STATE_COLOR[data.state]} variant="subtle">
                    {STATE_LABEL[data.state]}
                  </Badge>
                </VStack>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Score</Text>
                  <Text textStyle="sm" fontFamily="mono">
                    {data.score !== null ? data.score : "—"}
                  </Text>
                </VStack>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Dispatch</Text>
                  <Text textStyle="sm">
                    {data.score !== null ? formatTimeAgo(data.score) : "—"}
                  </Text>
                </VStack>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Group</Text>
                  <Button
                    size="2xs"
                    variant="outline"
                    onClick={() => onOpenGroup(data.groupId)}
                  >
                    View group
                  </Button>
                </VStack>
              </HStack>

              {data.error ? (
                <VStack align="stretch" gap={1}>
                  <Text textStyle="xs" color="fg.muted">Last error</Text>
                  <Card.Root borderColor="red.500/20">
                    <Card.Body padding={3}>
                      <Text textStyle="xs" color="red.500" whiteSpace="pre-wrap" wordBreak="break-word">
                        {data.error.message ?? "(no message)"}
                      </Text>
                      {data.error.stack ? (
                        <Box marginTop={2} maxHeight="200px" overflow="auto" bg="bg.subtle" borderRadius="sm" padding={2}>
                          <Text textStyle="2xs" fontFamily="mono" color="fg.muted" whiteSpace="pre">
                            {data.error.stack}
                          </Text>
                        </Box>
                      ) : null}
                    </Card.Body>
                  </Card.Root>
                </VStack>
              ) : null}

              <VStack align="stretch" gap={1}>
                <Text textStyle="xs" color="fg.muted">Payload</Text>
                <Box bg="bg.subtle" borderRadius="sm" padding={2} maxHeight="320px" overflow="auto">
                  <Text as="pre" textStyle="2xs" fontFamily="mono" whiteSpace="pre-wrap" wordBreak="break-word">
                    {data.data
                      ? JSON.stringify(data.data, null, 2)
                      : data.rawData ?? "(no data)"}
                  </Text>
                </Box>
              </VStack>
            </VStack>
          ) : (
            <Text textStyle="xs" color="fg.muted">Job not found.</Text>
          )}
        </Dialog.Body>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
