import { Box, Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { Link } from "../ui/link";
import { Table } from "@chakra-ui/react";
import { Tooltip } from "../ui/tooltip";

export function Events({ traceId }: { traceId: string }) {
  const { trace } = useTraceDetailsState(traceId);

  return trace.data && (trace.data?.events ?? []).length == 0 ? (
    <Text>
      No events found.{" "}
      <Link
        href="https://docs.langwatch.ai/user-events/custom"
        target="_blank"
        textDecoration="underline"
      >
        Get started with events
      </Link>
      .
    </Text>
  ) : (
    <VStack align="start">
      {trace.data?.events?.map((event) => (
        <VStack
          key={event.event_id}
          backgroundColor="gray.100"
          width="full"
          padding={6}
          borderRadius="lg"
          align="start"
          gap={4}
        >
          <HStack width="full">
            <Heading size="md">{event.event_type}</Heading>
            <Spacer />
            {event.timestamps.started_at && (
              <Tooltip
                content={new Date(event.timestamps.started_at).toLocaleString()}
              >
                <Text color="gray.400" borderBottom="1px dashed">
                  {formatTimeAgo(event.timestamps.started_at)}
                </Text>
              </Tooltip>
            )}
          </HStack>
          <Box
            borderRadius="6px"
            borderWidth="1px"
            borderColor="gray.400"
            width="full"
          >
            <Table.Root
              size="sm"
              background="white"
              borderRadius="6px"
              variant="line"
              border="none"
            >
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="50%">Metric</Table.ColumnHeader>
                  <Table.ColumnHeader width="50%">Value</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {Object.entries(event.metrics ?? {}).map(([key, value]) => (
                  <Table.Row key={key}>
                    <Table.Cell>{key}</Table.Cell>
                    <Table.Cell>{value}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Event Detail</Table.ColumnHeader>
                  <Table.ColumnHeader>Value</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {Object.entries(event.event_details ?? {}).map(
                  ([key, value]) => (
                    <Table.Row key={key}>
                      <Table.Cell>{key}</Table.Cell>
                      <Table.Cell>{value}</Table.Cell>
                    </Table.Row>
                  )
                )}
              </Table.Body>
            </Table.Root>
          </Box>
        </VStack>
      ))}
    </VStack>
  );
}
