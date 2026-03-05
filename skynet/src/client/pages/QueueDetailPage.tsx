import { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Table, Thead, Tbody, Tr, Th, Td, Text, Button, HStack, Code, Spinner,
  AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader,
  AlertDialogBody, AlertDialogFooter, Tooltip, useDisclosure,
  Breadcrumb, BreadcrumbItem, BreadcrumbLink,
} from "@chakra-ui/react";
import { ChevronRightIcon } from "@chakra-ui/icons";
import { Link, useParams } from "react-router-dom";
import type { BullMQJob, BullMQJobState, BullMQQueueInfo } from "../../shared/types.ts";
import { useQueueJobs } from "../hooks/useQueueJobs.ts";
import { apiFetch, apiPost } from "../hooks/useApi.ts";
import { timeAgo } from "../utils/timeAgo.ts";
import { CopyButton } from "../components/CopyButton.tsx";
import { stripHashTag } from "../utils/stripHashTag.ts";

const STATES: BullMQJobState[] = ["waiting", "active", "completed", "failed", "delayed"];

const STATE_COLORS: Record<BullMQJobState, string> = {
  waiting: "#00f0ff",
  active: "#00ff41",
  completed: "#4a6a7a",
  failed: "#ff0033",
  delayed: "#ffaa00",
};

function StateTabs({
  selected,
  onSelect,
  counts,
}: {
  selected: BullMQJobState;
  onSelect: (s: BullMQJobState) => void;
  counts: Record<BullMQJobState, number>;
}) {
  return (
    <HStack spacing={2} flexWrap="wrap">
      {STATES.map((s) => {
        const isSelected = s === selected;
        const color = STATE_COLORS[s];
        return (
          <Button
            key={s}
            size="sm"
            px={4}
            py={1}
            h="auto"
            borderRadius="2px"
            textTransform="uppercase"
            letterSpacing="0.1em"
            fontSize="xs"
            fontWeight={isSelected ? "700" : "400"}
            bg={isSelected ? `${color}15` : "transparent"}
            color={isSelected ? color : "#4a6a7a"}
            border="1px solid"
            borderColor={isSelected ? `${color}40` : "rgba(255,255,255,0.06)"}
            _hover={{
              bg: `${color}10`,
              color: color,
              borderColor: `${color}30`,
            }}
            onClick={() => onSelect(s)}
          >
            {s} ({counts[s]?.toLocaleString() ?? 0})
          </Button>
        );
      })}
    </HStack>
  );
}

function JobRow({ job, onRefresh }: { job: BullMQJob; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await apiPost("/api/bullmq/retry", { queueName: job.queueName, jobId: job.id });
      onRefresh();
    } finally {
      setRetrying(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await apiPost("/api/bullmq/remove", { queueName: job.queueName, jobId: job.id });
      setAlertOpen(false);
      onRefresh();
    } finally {
      setRemoving(false);
    }
  };

  const handlePromote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setPromoting(true);
    try {
      await apiPost("/api/bullmq/promote", { queueName: job.queueName, jobId: job.id });
      onRefresh();
    } finally {
      setPromoting(false);
    }
  };

  const dataSummary = (() => {
    try {
      const str = JSON.stringify(job.data);
      return str.length > 80 ? str.slice(0, 80) + "..." : str;
    } catch {
      return "{}";
    }
  })();

  return (
    <>
      <Tr cursor="pointer" onClick={() => setExpanded(!expanded)} _hover={{ bg: "rgba(0, 240, 255, 0.03)" }}>
        <Td w="130px" maxW="130px">
          <HStack spacing={1}>
            <Tooltip label={job.id} openDelay={200}>
              <Text fontFamily="mono" fontSize="xs" isTruncated color="#6a8a9a">{job.id}</Text>
            </Tooltip>
            <CopyButton value={job.id} />
          </HStack>
        </Td>
        <Td w="130px" maxW="130px">
          <Tooltip label={job.name} openDelay={200}>
            <Text fontSize="xs" color="#4a6a7a" isTruncated>{job.name}</Text>
          </Tooltip>
        </Td>
        <Td w="250px" maxW="250px">
          <Tooltip label={dataSummary} openDelay={200}>
            <Text fontSize="xs" color="#4a6a7a" fontFamily="mono" isTruncated>{dataSummary}</Text>
          </Tooltip>
        </Td>
        <Td isNumeric w="70px">
          <Text fontSize="xs" color="#ffaa00" sx={{ fontVariantNumeric: "tabular-nums" }}>{job.attemptsMade}</Text>
        </Td>
        <Td w="100px">
          <Text fontSize="xs" color="#4a6a7a">{timeAgo(job.timestamp)}</Text>
        </Td>
        <Td w="160px">
          <HStack spacing={1} onClick={(e) => e.stopPropagation()}>
            {(job.state === "failed" || job.state === "completed") && (
              <Button
                size="xs"
                variant="outline"
                color="#00f0ff"
                borderColor="rgba(0, 240, 255, 0.3)"
                _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.3)" }}
                onClick={handleRetry}
                isLoading={retrying}
              >
                Retry
              </Button>
            )}
            {job.state === "delayed" && (
              <Button
                size="xs"
                variant="outline"
                color="#ffaa00"
                borderColor="rgba(255, 170, 0, 0.3)"
                _hover={{ borderColor: "#ffaa00", boxShadow: "0 0 8px rgba(255, 170, 0, 0.3)" }}
                onClick={handlePromote}
                isLoading={promoting}
              >
                Promote
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              color="#ff0033"
              borderColor="rgba(255, 0, 51, 0.3)"
              _hover={{ borderColor: "#ff0033", boxShadow: "0 0 8px rgba(255, 0, 51, 0.3)" }}
              onClick={(e) => { e.stopPropagation(); setAlertOpen(true); }}
            >
              Remove
            </Button>
          </HStack>
        </Td>
      </Tr>

      {expanded && (
        <Tr>
          <Td colSpan={6} p={0}>
            <Box px={4} py={3} bg="#060a12">
              <HStack spacing={6} align="start" flexWrap="wrap">
                <Box flex="1" minW="300px">
                  <Text fontSize="xs" color="#00f0ff" mb={2} fontWeight="600" textTransform="uppercase" letterSpacing="0.1em">
                    // Data
                  </Text>
                  <Code
                    display="block"
                    whiteSpace="pre-wrap"
                    wordBreak="break-all"
                    p={3}
                    bg="#0a0408"
                    border="1px solid rgba(0, 240, 255, 0.1)"
                    borderRadius="2px"
                    fontSize="11px"
                    color="#b0c4d8"
                    maxH="300px"
                    overflow="auto"
                  >
                    {JSON.stringify(job.data, null, 2)}
                  </Code>
                </Box>

                {job.state === "failed" && (job.failedReason || job.stacktrace.length > 0) && (
                  <Box flex="1" minW="300px">
                    <Text fontSize="xs" color="#ff0033" mb={2} fontWeight="600" textTransform="uppercase" letterSpacing="0.1em">
                      // Error
                    </Text>
                    <Code
                      display="block"
                      whiteSpace="pre-wrap"
                      wordBreak="break-all"
                      p={3}
                      bg="#0a0408"
                      border="1px solid rgba(255, 0, 51, 0.15)"
                      borderRadius="2px"
                      fontSize="11px"
                      color="#ff4466"
                      maxH="300px"
                      overflow="auto"
                    >
                      {job.stacktrace.join("\n") || job.failedReason}
                    </Code>
                  </Box>
                )}

                {job.state === "completed" && job.returnvalue != null && (
                  <Box flex="1" minW="300px">
                    <Text fontSize="xs" color="#00ff41" mb={2} fontWeight="600" textTransform="uppercase" letterSpacing="0.1em">
                      // Return Value
                    </Text>
                    <Code
                      display="block"
                      whiteSpace="pre-wrap"
                      wordBreak="break-all"
                      p={3}
                      bg="#0a0408"
                      border="1px solid rgba(0, 255, 65, 0.1)"
                      borderRadius="2px"
                      fontSize="11px"
                      color="#b0c4d8"
                      maxH="300px"
                      overflow="auto"
                    >
                      {typeof job.returnvalue === "string" ? job.returnvalue : JSON.stringify(job.returnvalue, null, 2)}
                    </Code>
                  </Box>
                )}
              </HStack>

              <HStack spacing={6} mt={3} flexWrap="wrap">
                <Box>
                  <Text fontSize="xs" color="#4a6a7a" mb={1} fontWeight="600" textTransform="uppercase" letterSpacing="0.1em">
                    // Timestamps
                  </Text>
                  <Text fontSize="11px" fontFamily="mono" color="#6a8a9a">
                    Created: {new Date(job.timestamp).toISOString()}
                    {job.processedOn ? `  |  Processed: ${new Date(job.processedOn).toISOString()}` : ""}
                    {job.finishedOn ? `  |  Finished: ${new Date(job.finishedOn).toISOString()}` : ""}
                  </Text>
                </Box>
                <Box>
                  <Text fontSize="xs" color="#4a6a7a" mb={1} fontWeight="600" textTransform="uppercase" letterSpacing="0.1em">
                    // Options
                  </Text>
                  <Code fontSize="11px" color="#6a8a9a" bg="transparent">
                    {JSON.stringify(job.opts)}
                  </Code>
                </Box>
              </HStack>
            </Box>
          </Td>
        </Tr>
      )}

      <AlertDialog isOpen={alertOpen} leastDestructiveRef={cancelRef} onClose={() => setAlertOpen(false)}>
        <AlertDialogOverlay>
          <AlertDialogContent bg="#0a0e17" border="1px solid rgba(255, 0, 51, 0.3)" borderRadius="2px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="#ff0033" textTransform="uppercase">
              Remove Job
            </AlertDialogHeader>
            <AlertDialogBody color="#b0c4d8">
              Remove job <Text as="span" fontFamily="mono" color="#ff0033">{job.id}</Text>?
              {job.state === "active" && (
                <Text mt={2} color="#ffaa00" fontSize="sm">
                  Warning: This job is currently active. Removing it may cause unexpected behavior.
                </Text>
              )}
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={() => setAlertOpen(false)} variant="ghost" color="#6a8a9a">Cancel</Button>
              <Button
                bg="rgba(255, 0, 51, 0.2)"
                color="#ff0033"
                border="1px solid rgba(255, 0, 51, 0.3)"
                _hover={{ bg: "rgba(255, 0, 51, 0.3)", boxShadow: "0 0 12px rgba(255, 0, 51, 0.3)" }}
                onClick={handleRemove}
                isLoading={removing}
                ml={3}
              >
                Remove
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
}

export function QueueDetailPage() {
  const { queueName: rawParam } = useParams<{ queueName: string }>();
  const queueName = decodeURIComponent(rawParam ?? "");
  const displayName = stripHashTag(queueName);

  const [state, setState] = useState<BullMQJobState>("waiting");
  const [counts, setCounts] = useState<Record<BullMQJobState, number>>({
    waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
  });

  const { data, loading, page, setPage, refresh } = useQueueJobs(queueName, state);

  const fetchCounts = useCallback(async () => {
    try {
      const result = await apiFetch<{ queues: BullMQQueueInfo[] }>("/api/bullmq/queues");
      const found = result.queues.find((q) => q.name === queueName);
      if (found) {
        setCounts({
          waiting: found.waiting,
          active: found.active,
          completed: found.completed,
          failed: found.failed,
          delayed: found.delayed,
        });
      }
    } catch {
      // ignore
    }
  }, [queueName]);

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, 10_000);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  // Also update counts from job data when available
  useEffect(() => {
    if (data) {
      setCounts((prev) => ({ ...prev, [data.state]: data.total }));
    }
  }, [data]);

  const handleStateChange = (s: BullMQJobState) => {
    setState(s);
  };

  const hasBulkActions = state === "failed" || state === "delayed" || state === "completed";
  const canRetry = state === "failed";

  const { isOpen: isRemoveAllOpen, onOpen: onRemoveAllOpen, onClose: onRemoveAllClose } = useDisclosure();
  const { isOpen: isRetryAllOpen, onOpen: onRetryAllOpen, onClose: onRetryAllClose } = useDisclosure();
  const removeAllCancelRef = useRef<HTMLButtonElement>(null);
  const retryAllCancelRef = useRef<HTMLButtonElement>(null);
  const [removingAll, setRemovingAll] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);

  const handleRemoveAll = async () => {
    setRemovingAll(true);
    try {
      await apiPost(`/api/bullmq/queues/${encodeURIComponent(queueName)}/remove-all`, { state });
      onRemoveAllClose();
      refresh();
      fetchCounts();
    } finally {
      setRemovingAll(false);
    }
  };

  const handleRetryAll = async () => {
    setRetryingAll(true);
    try {
      await apiPost(`/api/bullmq/queues/${encodeURIComponent(queueName)}/retry-all`, {});
      onRetryAllClose();
      refresh();
      fetchCounts();
    } finally {
      setRetryingAll(false);
    }
  };

  return (
    <Box p={6}>
      <Breadcrumb separator={<ChevronRightIcon color="#4a6a7a" />} mb={4}>
        <BreadcrumbItem>
          <BreadcrumbLink as={Link} to="/queues" color="#4a6a7a" fontSize="sm" textTransform="uppercase" letterSpacing="0.1em">
            Queues
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbItem isCurrentPage>
          <Text color="#00f0ff" fontSize="sm" textTransform="uppercase" letterSpacing="0.1em" fontWeight="600">
            {displayName}
          </Text>
        </BreadcrumbItem>
      </Breadcrumb>

      <Text
        fontSize="xl"
        fontWeight="bold"
        mb={4}
        color="#00f0ff"
        textTransform="uppercase"
        letterSpacing="0.2em"
        textShadow="0 0 15px rgba(0, 240, 255, 0.3)"
      >
        // {displayName}
      </Text>

      <HStack mb={4} justify="space-between" align="flex-start">
        <StateTabs selected={state} onSelect={handleStateChange} counts={counts} />
        {hasBulkActions && counts[state] > 0 && (
          <HStack spacing={2} flexShrink={0}>
            {canRetry && (
              <Button
                size="sm"
                variant="outline"
                color="#00f0ff"
                borderColor="rgba(0, 240, 255, 0.3)"
                borderRadius="2px"
                _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.3)" }}
                textTransform="uppercase"
                letterSpacing="0.05em"
                fontSize="xs"
                onClick={onRetryAllOpen}
              >
                Retry All
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              color="#ff0033"
              borderColor="rgba(255, 0, 51, 0.3)"
              borderRadius="2px"
              _hover={{ borderColor: "#ff0033", boxShadow: "0 0 8px rgba(255, 0, 51, 0.3)" }}
              textTransform="uppercase"
              letterSpacing="0.05em"
              fontSize="xs"
              onClick={onRemoveAllOpen}
            >
              Remove All
            </Button>
          </HStack>
        )}
      </HStack>

      <AlertDialog isOpen={isRemoveAllOpen} leastDestructiveRef={removeAllCancelRef} onClose={onRemoveAllClose}>
        <AlertDialogOverlay>
          <AlertDialogContent bg="#0a0e17" border="1px solid rgba(255, 0, 51, 0.3)" borderRadius="2px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="#ff0033" textTransform="uppercase">
              Remove All {state} Jobs
            </AlertDialogHeader>
            <AlertDialogBody color="#b0c4d8">
              Permanently remove all <Text as="span" fontWeight="600" color="#ff0033">{counts[state].toLocaleString()}</Text> {state} jobs from <Text as="span" fontWeight="600" color="#00f0ff">{displayName}</Text>? This cannot be undone.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={removeAllCancelRef} onClick={onRemoveAllClose} variant="ghost" color="#6a8a9a">Cancel</Button>
              <Button
                bg="rgba(255, 0, 51, 0.2)"
                color="#ff0033"
                border="1px solid rgba(255, 0, 51, 0.3)"
                _hover={{ bg: "rgba(255, 0, 51, 0.3)", boxShadow: "0 0 12px rgba(255, 0, 51, 0.3)" }}
                onClick={handleRemoveAll}
                isLoading={removingAll}
                ml={3}
              >
                Remove All
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <AlertDialog isOpen={isRetryAllOpen} leastDestructiveRef={retryAllCancelRef} onClose={onRetryAllClose}>
        <AlertDialogOverlay>
          <AlertDialogContent bg="#0a0e17" border="1px solid rgba(0, 240, 255, 0.3)" borderRadius="2px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="#00f0ff" textTransform="uppercase">
              Retry All Failed Jobs
            </AlertDialogHeader>
            <AlertDialogBody color="#b0c4d8">
              Retry all <Text as="span" fontWeight="600" color="#00f0ff">{counts[state].toLocaleString()}</Text> failed jobs in <Text as="span" fontWeight="600" color="#00f0ff">{displayName}</Text>?
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={retryAllCancelRef} onClick={onRetryAllClose} variant="ghost" color="#6a8a9a">Cancel</Button>
              <Button
                bg="rgba(0, 240, 255, 0.15)"
                color="#00f0ff"
                border="1px solid rgba(0, 240, 255, 0.3)"
                _hover={{ bg: "rgba(0, 240, 255, 0.25)", boxShadow: "0 0 12px rgba(0, 240, 255, 0.3)" }}
                onClick={handleRetryAll}
                isLoading={retryingAll}
                ml={3}
              >
                Retry All
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {loading && !data ? (
        <Box textAlign="center" py={12}>
          <Spinner color="#00f0ff" size="lg" />
          <Text mt={4} color="#4a6a7a" textTransform="uppercase" fontSize="sm">
            Scanning queue...
          </Text>
        </Box>
      ) : (
        <>
          <Box
            bg="#0a0e17"
            borderRadius="2px"
            border="1px solid"
            borderColor={`${STATE_COLORS[state]}15`}
            boxShadow={`0 0 8px ${STATE_COLORS[state]}08`}
            overflow="hidden"
          >
            <Table size="sm" variant="simple" sx={{ tableLayout: "fixed" }}>
              <Thead>
                <Tr>
                  <Th w="130px" color={STATE_COLORS[state]}>Job ID</Th>
                  <Th w="130px" color={STATE_COLORS[state]}>Name</Th>
                  <Th w="250px" color={STATE_COLORS[state]}>Data</Th>
                  <Th isNumeric w="70px" color={STATE_COLORS[state]}>Attempts</Th>
                  <Th w="100px" color={STATE_COLORS[state]}>Created</Th>
                  <Th w="160px" color={STATE_COLORS[state]}>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {(!data || data.jobs.length === 0) ? (
                  <Tr>
                    <Td colSpan={6} textAlign="center" color="#4a6a7a" py={8}>
                      NO {state.toUpperCase()} JOBS
                    </Td>
                  </Tr>
                ) : (
                  data.jobs.map((job) => (
                    <JobRow key={job.id} job={job} onRefresh={refresh} />
                  ))
                )}
              </Tbody>
            </Table>
          </Box>

          {data && data.totalPages > 1 && (
            <HStack justify="center" mt={4} spacing={2}>
              <Button
                size="sm"
                variant="outline"
                color="#00f0ff"
                borderColor="rgba(0, 240, 255, 0.3)"
                _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.2)" }}
                isDisabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Text fontSize="sm" color="#6a8a9a">{page + 1} / {data.totalPages}</Text>
              <Button
                size="sm"
                variant="outline"
                color="#00f0ff"
                borderColor="rgba(0, 240, 255, 0.3)"
                _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.2)" }}
                isDisabled={page >= data.totalPages - 1}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </HStack>
          )}
        </>
      )}
    </Box>
  );
}
