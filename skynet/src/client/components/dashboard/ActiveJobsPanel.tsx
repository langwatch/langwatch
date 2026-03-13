import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Text, Table, Thead, Tbody, Tr, Th, Td, Badge, HStack, Tooltip } from "@chakra-ui/react";
import type { QueueInfo, GroupInfo } from "../../../shared/types.ts";

const TABULAR_NUMS = { fontVariantNumeric: "tabular-nums" } as const;

function ActiveRow({ group, queueName }: { group: GroupInfo; queueName: string }) {
  const navigate = useNavigate();
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const ttlSec = group.activeKeyTtlSec ?? 0;
  const ttlColor = ttlSec < 30 ? "#ff0033" : ttlSec < 60 ? "#ffaa00" : "#00ff41";

  return (
    <Tr
      cursor="pointer"
      onClick={() => navigate(`/groups/${encodeURIComponent(group.groupId)}?queue=${encodeURIComponent(queueName)}`)}
      _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
    >
      <Td>
        <Tooltip label={group.groupId} openDelay={200}>
          <Text fontFamily="mono" fontSize="xs" color="#6a8a9a" isTruncated maxW="200px">
            {group.groupId}
          </Text>
        </Tooltip>
      </Td>
      <Td>
        <Text fontSize="xs" color="#4a6a7a" isTruncated maxW="150px">
          {group.pipelineName ?? "-"}
        </Text>
      </Td>
      <Td>
        <Badge
          bg={`rgba(${ttlSec < 30 ? "255, 0, 51" : ttlSec < 60 ? "255, 170, 0" : "0, 255, 65"}, 0.15)`}
          color={ttlColor}
          fontSize="10px"
          borderRadius="2px"
          sx={TABULAR_NUMS}
        >
          {ttlSec}s
        </Badge>
      </Td>
    </Tr>
  );
}

export function ActiveJobsPanel({ queues }: { queues: QueueInfo[] }) {
  const activeGroups: { group: GroupInfo; queueName: string }[] = [];
  for (const q of queues) {
    for (const g of q.groups) {
      if (g.hasActiveJob) {
        activeGroups.push({ group: g, queueName: q.name });
      }
    }
  }

  if (activeGroups.length === 0) return null;

  // Sort by TTL ascending (most urgent first)
  activeGroups.sort((a, b) => (a.group.activeKeyTtlSec ?? 0) - (b.group.activeKeyTtlSec ?? 0));

  return (
    <Box
      bg="#0a0e17"
      p={4}
      borderRadius="2px"
      border="1px solid"
      borderColor="rgba(0, 255, 65, 0.15)"
      boxShadow="0 0 8px rgba(0, 255, 65, 0.08)"
    >
      <HStack mb={3}>
        <Text
          fontSize="xs"
          color="#00ff41"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.15em"
        >
          // Active Jobs
        </Text>
        <Badge bg="rgba(0, 255, 65, 0.12)" color="#00ff41" fontSize="10px" borderRadius="2px">
          {activeGroups.length}
        </Badge>
      </HStack>
      <Box overflowX="auto" maxH="250px" overflowY="auto">
        <Table size="sm" variant="simple">
          <Thead>
            <Tr>
              <Th>Group ID</Th>
              <Th>Pipeline</Th>
              <Th>TTL</Th>
            </Tr>
          </Thead>
          <Tbody>
            {activeGroups.slice(0, 20).map(({ group, queueName }) => (
              <ActiveRow key={`${queueName}:${group.groupId}`} group={group} queueName={queueName} />
            ))}
          </Tbody>
        </Table>
      </Box>
      {activeGroups.length > 20 && (
        <Text fontSize="9px" color="#4a6a7a" mt={2} textAlign="center">
          + {activeGroups.length - 20} more active jobs
        </Text>
      )}
    </Box>
  );
}
