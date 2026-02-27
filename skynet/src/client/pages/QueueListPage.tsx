import { useState, useEffect, useCallback } from "react";
import { Box, Table, Thead, Tbody, Tr, Th, Td, Text, Spinner } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import type { BullMQQueueInfo } from "../../shared/types.ts";
import { apiFetch } from "../hooks/useApi.ts";

function StateCount({ count, color }: { count: number; color: string }) {
  return (
    <Text
      fontSize="xs"
      fontFamily="mono"
      color={count > 0 ? color : "#2a3a4a"}
      sx={{ fontVariantNumeric: "tabular-nums" }}
    >
      {count.toLocaleString()}
    </Text>
  );
}

export function QueueListPage() {
  const [queues, setQueues] = useState<BullMQQueueInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQueues = useCallback(async () => {
    try {
      const data = await apiFetch<{ queues: BullMQQueueInfo[] }>("/api/bullmq/queues");
      setQueues(data.queues);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 5000);
    return () => clearInterval(interval);
  }, [fetchQueues]);

  return (
    <Box p={6}>
      <Text
        fontSize="xl"
        fontWeight="bold"
        mb={2}
        color="#00f0ff"
        textTransform="uppercase"
        letterSpacing="0.2em"
        textShadow="0 0 15px rgba(0, 240, 255, 0.3)"
      >
        // Queue Browser
      </Text>
      <Text fontSize="sm" color="#4a6a7a" mb={6} textTransform="uppercase" letterSpacing="0.1em">
        BullMQ queues across all workers. Click a queue to inspect jobs.
      </Text>

      {queues.length === 0 ? (
        <Box textAlign="center" py={12}>
          <Spinner color="#00f0ff" size="lg" />
          <Text mt={4} color="#4a6a7a" textTransform="uppercase" fontSize="sm">
            {loading ? "Establishing link..." : "Discovering queues..."}
          </Text>
        </Box>
      ) : (
        <Box
          bg="#0a0e17"
          borderRadius="2px"
          border="1px solid"
          borderColor="rgba(0, 240, 255, 0.15)"
          boxShadow="0 0 8px rgba(0, 240, 255, 0.06)"
          overflow="hidden"
        >
          <Table size="sm" variant="simple">
            <Thead>
              <Tr>
                <Th color="#00f0ff">Queue</Th>
                <Th isNumeric color="#00f0ff">Waiting</Th>
                <Th isNumeric color="#00f0ff">Active</Th>
                <Th isNumeric color="#00f0ff">Completed</Th>
                <Th isNumeric color="#00f0ff">Failed</Th>
                <Th isNumeric color="#00f0ff">Delayed</Th>
              </Tr>
            </Thead>
            <Tbody>
              {queues.length === 0 ? (
                <Tr>
                  <Td colSpan={6} textAlign="center" color="#4a6a7a" py={8}>
                    NO QUEUES DISCOVERED
                  </Td>
                </Tr>
              ) : (
                queues.map((q) => (
                  <Tr
                    key={q.name}
                    _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
                    cursor="pointer"
                    as={Link}
                    to={`/queues/${encodeURIComponent(q.name)}`}
                    display="table-row"
                  >
                    <Td>
                      <Text fontSize="sm" color="#b0c4d8" fontWeight="500">
                        {q.displayName}
                      </Text>
                    </Td>
                    <Td isNumeric><StateCount count={q.waiting} color="#00f0ff" /></Td>
                    <Td isNumeric><StateCount count={q.active} color="#00ff41" /></Td>
                    <Td isNumeric><StateCount count={q.completed} color="#4a6a7a" /></Td>
                    <Td isNumeric><StateCount count={q.failed} color="#ff0033" /></Td>
                    <Td isNumeric><StateCount count={q.delayed} color="#ffaa00" /></Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </Box>
      )}
    </Box>
  );
}
