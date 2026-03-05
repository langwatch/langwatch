import { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Table, Thead, Tbody, Tr, Th, Td, Text, Button, Tooltip,
  HStack, Input, Code, useDisclosure,
  AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader,
  AlertDialogBody, AlertDialogFooter,
} from "@chakra-ui/react";
import type { FailedJob } from "../../../shared/types.ts";
import { apiFetch, apiPost } from "../../hooks/useApi.ts";
import { timeAgo } from "../../utils/timeAgo.ts";
import { CopyButton } from "../CopyButton.tsx";
import { SEARCH_DEBOUNCE_MS } from "../../../shared/constants.ts";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function FailedJobRow({ job, onRefresh }: { job: FailedJob; onRefresh: () => void }) {
  const { isOpen, onToggle } = useDisclosure();
  const [retrying, setRetrying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { isOpen: isAlertOpen, onOpen: onAlertOpen, onClose: onAlertClose } = useDisclosure();
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
      onAlertClose();
      onRefresh();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Tr cursor="pointer" onClick={onToggle} _hover={{ bg: "rgba(255, 0, 51, 0.03)" }}>
        <Td w="120px" maxW="120px">
          <HStack spacing={1}>
            <Tooltip label={job.id} openDelay={200}>
              <Text fontFamily="mono" fontSize="xs" isTruncated color="#6a8a9a">{job.id}</Text>
            </Tooltip>
            <CopyButton value={job.id} />
          </HStack>
        </Td>
        <Td w="150px" maxW="150px">
          <HStack spacing={1}>
            <Tooltip label={job.pipelineName ?? job.queueDisplayName} openDelay={200}>
              <Text fontSize="xs" color="#4a6a7a" isTruncated>{job.pipelineName ?? job.queueDisplayName}</Text>
            </Tooltip>
            <CopyButton value={job.pipelineName ?? job.queueDisplayName} />
          </HStack>
        </Td>
        <Td w="120px" maxW="120px">
          <HStack spacing={1}>
            <Tooltip label={job.jobType ?? job.name} openDelay={200}>
              <Text fontSize="xs" color="#4a6a7a" isTruncated>{job.jobType ?? job.name}</Text>
            </Tooltip>
            <CopyButton value={job.jobType ?? job.name} />
          </HStack>
        </Td>
        <Td w="280px" maxW="280px">
          <HStack spacing={1}>
            <Tooltip label={job.failedReason} openDelay={200}>
              <Text fontSize="xs" color="#ff0033" isTruncated>{job.failedReason}</Text>
            </Tooltip>
            <CopyButton value={job.failedReason} />
          </HStack>
        </Td>
        <Td isNumeric w="70px">
          <Text fontSize="xs" color="#ffaa00" sx={{ fontVariantNumeric: "tabular-nums" }}>{job.attemptsMade}</Text>
        </Td>
        <Td w="100px">
          <Text fontSize="xs" color="#4a6a7a">{timeAgo(job.finishedOn ?? job.timestamp)}</Text>
        </Td>
        <Td w="140px">
          <HStack spacing={1}>
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
            <Button
              size="xs"
              variant="outline"
              color="#ff0033"
              borderColor="rgba(255, 0, 51, 0.3)"
              _hover={{ borderColor: "#ff0033", boxShadow: "0 0 8px rgba(255, 0, 51, 0.3)" }}
              onClick={(e) => { e.stopPropagation(); onAlertOpen(); }}
            >
              Remove
            </Button>
          </HStack>
        </Td>
      </Tr>
      {isOpen && (
        <Tr>
          <Td colSpan={7} p={0}>
            <Box px={4} py={3} bg="#060a12">
              <Text fontSize="xs" color="#ff0033" mb={2} fontWeight="600" textTransform="uppercase" letterSpacing="0.1em">
                // Stack Trace
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
          </Td>
        </Tr>
      )}

      <AlertDialog isOpen={isAlertOpen} leastDestructiveRef={cancelRef} onClose={onAlertClose}>
        <AlertDialogOverlay>
          <AlertDialogContent bg="#0a0e17" border="1px solid rgba(255, 0, 51, 0.3)" borderRadius="2px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="#ff0033" textTransform="uppercase">
              Remove Job
            </AlertDialogHeader>
            <AlertDialogBody color="#b0c4d8">
              Remove job <Text as="span" fontFamily="mono" color="#ff0033">{job.id}</Text>? This cannot be undone.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onAlertClose} variant="ghost" color="#6a8a9a">Cancel</Button>
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

export function FailedJobsList() {
  const [jobs, setJobs] = useState<FailedJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [retryingAll, setRetryingAll] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);
  const { isOpen: isRetryAllOpen, onOpen: onRetryAllOpen, onClose: onRetryAllClose } = useDisclosure();
  const { isOpen: isRemoveAllOpen, onOpen: onRemoveAllOpen, onClose: onRemoveAllClose } = useDisclosure();
  const retryAllCancelRef = useRef<HTMLButtonElement>(null);
  const removeAllCancelRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);

  const fetchJobs = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ jobs: FailedJob[]; total: number }>(`/api/bullmq/failed?page=${p}`);
      setJobs(data.jobs);
      setTotal(data.total);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch — only on mount
  useEffect(() => {
    fetchJobs(0);
    return () => { mountedRef.current = false; };
  }, [fetchJobs]);

  // Periodic refresh at current page — separate from initial fetch
  // so navigating to a new page doesn't reset to page 0
  useEffect(() => {
    const interval = setInterval(() => fetchJobs(page), 10000);
    return () => clearInterval(interval);
  }, [fetchJobs, page]);

  const handleRetryAll = async () => {
    setRetryingAll(true);
    try {
      await apiPost("/api/bullmq/retry-all-failed", {});
      onRetryAllClose();
      fetchJobs(0);
    } finally {
      setRetryingAll(false);
    }
  };

  const handleRemoveAll = async () => {
    setRemovingAll(true);
    try {
      await apiPost("/api/bullmq/remove-all-failed", {});
      onRemoveAllClose();
      fetchJobs(0);
    } finally {
      setRemovingAll(false);
    }
  };

  const filtered = jobs.filter(
    (j) =>
      j.id.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      (j.pipelineName ?? "").toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      (j.jobType ?? "").toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      j.failedReason.toLowerCase().includes(debouncedSearch.toLowerCase()),
  );

  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <Box>
      <HStack mb={4} spacing={3}>
        <Input
          placeholder="FILTER CURRENT PAGE..."
          size="sm"
          bg="#060a12"
          border="1px solid"
          borderColor="rgba(255, 0, 51, 0.2)"
          color="#b0c4d8"
          borderRadius="2px"
          _placeholder={{ color: "#4a6a7a", textTransform: "uppercase" }}
          _focus={{ borderColor: "#ff0033", boxShadow: "0 0 8px rgba(255, 0, 51, 0.2)" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxW="400px"
        />
        <Text fontSize="xs" color="#ff0033">{total} FAILED JOBS</Text>
        {total > 0 && (
          <>
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
              Delete All
            </Button>
          </>
        )}
      </HStack>

      <AlertDialog isOpen={isRetryAllOpen} leastDestructiveRef={retryAllCancelRef} onClose={onRetryAllClose}>
        <AlertDialogOverlay>
          <AlertDialogContent bg="#0a0e17" border="1px solid rgba(0, 240, 255, 0.3)" borderRadius="2px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="#00f0ff" textTransform="uppercase">
              Retry All Failed Jobs
            </AlertDialogHeader>
            <AlertDialogBody color="#b0c4d8">
              Retry all <Text as="span" fontWeight="600" color="#00f0ff">{total}</Text> failed jobs? They will be moved back to the waiting state.
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

      <AlertDialog isOpen={isRemoveAllOpen} leastDestructiveRef={removeAllCancelRef} onClose={onRemoveAllClose}>
        <AlertDialogOverlay>
          <AlertDialogContent bg="#0a0e17" border="1px solid rgba(255, 0, 51, 0.3)" borderRadius="2px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="#ff0033" textTransform="uppercase">
              Delete All Failed Jobs
            </AlertDialogHeader>
            <AlertDialogBody color="#b0c4d8">
              Permanently remove all <Text as="span" fontWeight="600" color="#ff0033">{total}</Text> failed jobs? This cannot be undone.
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
                Delete All
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <Box
        bg="#0a0e17"
        borderRadius="2px"
        border="1px solid"
        borderColor="rgba(255, 0, 51, 0.15)"
        boxShadow="0 0 8px rgba(255, 0, 51, 0.06)"
        overflow="hidden"
        minW="980px"
      >
        <Table size="sm" variant="simple" sx={{ tableLayout: "fixed" }}>
          <Thead>
            <Tr>
              <Th w="120px" color="#ff0033">Job ID</Th>
              <Th w="150px" color="#ff0033">Pipeline</Th>
              <Th w="120px" color="#ff0033">Job Type</Th>
              <Th w="280px" color="#ff0033">Failed Reason</Th>
              <Th isNumeric w="70px" color="#ff0033">Attempts</Th>
              <Th w="100px" color="#ff0033">Failed At</Th>
              <Th w="140px" color="#ff0033">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.length === 0 ? (
              <Tr>
                <Td colSpan={7} textAlign="center" color="#4a6a7a" py={8}>
                  {loading ? "ESTABLISHING LINK..." : debouncedSearch ? "NO MATCHES ON THIS PAGE" : "NO FAILED JOBS"}
                </Td>
              </Tr>
            ) : (
              filtered.map((job) => (
                <FailedJobRow key={`${job.queueName}-${job.id}`} job={job} onRefresh={() => fetchJobs(page)} />
              ))
            )}
          </Tbody>
        </Table>
      </Box>

      {totalPages > 1 && (
        <HStack justify="center" mt={4} spacing={2}>
          <Button
            size="sm"
            variant="outline"
            color="#00f0ff"
            borderColor="rgba(0, 240, 255, 0.3)"
            _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.2)" }}
            isDisabled={page === 0}
            onClick={() => fetchJobs(page - 1)}
          >
            Previous
          </Button>
          <Text fontSize="sm" color="#6a8a9a">{page + 1} / {totalPages}</Text>
          <Button
            size="sm"
            variant="outline"
            color="#00f0ff"
            borderColor="rgba(0, 240, 255, 0.3)"
            _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.2)" }}
            isDisabled={page >= totalPages - 1}
            onClick={() => fetchJobs(page + 1)}
          >
            Next
          </Button>
        </HStack>
      )}
    </Box>
  );
}
