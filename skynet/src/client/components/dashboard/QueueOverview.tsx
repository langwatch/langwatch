import { useState, useEffect, useCallback } from "react";
import {
  Box, Table, Thead, Tbody, Tr, Th, Td, Text, HStack, VStack, Spinner, Button,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
  useDisclosure,
} from "@chakra-ui/react";
import { Link, useNavigate } from "react-router-dom";
import type { BullMQQueueInfo } from "../../../shared/types.ts";
import { apiFetch } from "../../hooks/useApi.ts";

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

function StatBlock({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <Box textAlign="center" px={3}>
      <Text fontSize="9px" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em" mb={1}>
        {label}
      </Text>
      <Text
        fontSize="lg"
        fontWeight="600"
        fontFamily="mono"
        color={count > 0 ? color : "#2a3a4a"}
        sx={{ fontVariantNumeric: "tabular-nums" }}
        textShadow={count > 0 ? `0 0 10px ${color}40` : undefined}
      >
        {count.toLocaleString()}
      </Text>
    </Box>
  );
}

interface QueueDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  queue: BullMQQueueInfo | null;
}

function QueueDetailModal({ isOpen, onClose, queue }: QueueDetailModalProps) {
  const navigate = useNavigate();

  if (!queue) return null;
  const total = queue.waiting + queue.active + queue.completed + queue.failed + queue.delayed;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered>
      <ModalOverlay bg="rgba(0, 0, 0, 0.7)" />
      <ModalContent
        bg="#0a0e17"
        border="1px solid"
        borderColor="rgba(0, 240, 255, 0.4)"
        boxShadow="0 0 30px rgba(0, 240, 255, 0.15), inset 0 0 20px rgba(0, 240, 255, 0.03)"
        borderRadius="2px"
        maxW="550px"
      >
        <ModalHeader
          color="#00f0ff"
          fontSize="sm"
          textTransform="uppercase"
          letterSpacing="0.1em"
          borderBottom="1px solid"
          borderColor="rgba(0, 240, 255, 0.15)"
          pb={3}
        >
          Queue Detail
        </ModalHeader>
        <ModalCloseButton color="#4a6a7a" _hover={{ color: "#00f0ff" }} />
        <ModalBody py={4}>
          <VStack align="stretch" spacing={4}>
            <HStack>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="80px">Name</Text>
              <Text fontFamily="mono" fontSize="sm" color="#b0c4d8" fontWeight="500">
                {queue.displayName}
              </Text>
            </HStack>
            <HStack>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="80px">Total</Text>
              <Text fontWeight="600" color="#00f0ff" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {total.toLocaleString()}
              </Text>
            </HStack>

            <Box
              border="1px solid"
              borderColor="rgba(0, 240, 255, 0.1)"
              borderRadius="2px"
              py={3}
            >
              <HStack justify="space-around">
                <StatBlock label="Waiting" count={queue.waiting} color="#00f0ff" />
                <StatBlock label="Active" count={queue.active} color="#00ff41" />
                <StatBlock label="Completed" count={queue.completed} color="#4a6a7a" />
                <StatBlock label="Failed" count={queue.failed} color="#ff0033" />
                <StatBlock label="Delayed" count={queue.delayed} color="#ffaa00" />
              </HStack>
            </Box>

            <Button
              size="sm"
              variant="outline"
              color="#00f0ff"
              borderColor="rgba(0, 240, 255, 0.3)"
              borderRadius="2px"
              _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 12px rgba(0, 240, 255, 0.3)" }}
              textTransform="uppercase"
              letterSpacing="0.1em"
              fontSize="xs"
              onClick={() => navigate(`/queues/${encodeURIComponent(queue.name)}`)}
              alignSelf="flex-end"
            >
              View Full Page
            </Button>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

function QueueRow({ queue, onSelect }: { queue: BullMQQueueInfo; onSelect: (q: BullMQQueueInfo) => void }) {
  return (
    <Tr
      _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
      cursor="pointer"
      onClick={() => onSelect(queue)}
    >
      <Td>
        <Text fontSize="sm" color="#b0c4d8" fontWeight="500">
          {queue.displayName}
        </Text>
      </Td>
      <Td isNumeric><StateCount count={queue.waiting} color="#00f0ff" /></Td>
      <Td isNumeric><StateCount count={queue.active} color="#00ff41" /></Td>
      <Td isNumeric><StateCount count={queue.completed} color="#4a6a7a" /></Td>
      <Td isNumeric><StateCount count={queue.failed} color="#ff0033" /></Td>
      <Td isNumeric><StateCount count={queue.delayed} color="#ffaa00" /></Td>
    </Tr>
  );
}

export function QueueOverview() {
  const [queues, setQueues] = useState<BullMQQueueInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Shared modal state — single modal for all rows
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedQueue, setSelectedQueue] = useState<BullMQQueueInfo | null>(null);

  const handleSelect = useCallback((queue: BullMQQueueInfo) => {
    setSelectedQueue(queue);
    onOpen();
  }, [onOpen]);

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
    // Reduced from 5s to 30s — the SSE dashboard data already provides group-level
    // queue info every 2s. This polling only supplements with BullMQ job state counts.
    const interval = setInterval(fetchQueues, 30_000);
    return () => clearInterval(interval);
  }, [fetchQueues]);

  return (
    <Box mb={6}>
      <HStack justify="space-between" mb={3}>
        <Text
          fontSize="sm"
          fontWeight="600"
          color="#00f0ff"
          textTransform="uppercase"
          letterSpacing="0.15em"
        >
          // Queues
        </Text>
        <Text
          as={Link}
          to="/queues"
          fontSize="xs"
          color="#4a6a7a"
          textTransform="uppercase"
          letterSpacing="0.1em"
          _hover={{ color: "#00f0ff" }}
        >
          View All
        </Text>
      </HStack>

      {loading && queues.length === 0 ? (
        <Box textAlign="center" py={6}>
          <Spinner color="#00f0ff" size="sm" />
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
                  <Td colSpan={6} textAlign="center" color="#4a6a7a" py={6}>
                    NO QUEUES DISCOVERED
                  </Td>
                </Tr>
              ) : (
                queues.map((q) => (
                  <QueueRow key={q.name} queue={q} onSelect={handleSelect} />
                ))
              )}
            </Tbody>
          </Table>
        </Box>
      )}

      {/* Single shared modal */}
      <QueueDetailModal isOpen={isOpen} onClose={onClose} queue={selectedQueue} />
    </Box>
  );
}
