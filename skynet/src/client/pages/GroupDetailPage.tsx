import { Box, Text, HStack, VStack, Badge, Button, Code, Spinner, useDisclosure, useToast, Collapse,
  AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader,
  AlertDialogBody, AlertDialogFooter,
} from "@chakra-ui/react";
import { useRef, useState } from "react";
import { ChevronRightIcon, ChevronDownIcon } from "@chakra-ui/icons";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useGroupDetail } from "../hooks/useGroupDetail.ts";
import { JobList } from "../components/jobs/JobList.tsx";
import { apiPost } from "../hooks/useApi.ts";

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams] = useSearchParams();
  const queueName = searchParams.get("queue") ?? undefined;
  const toast = useToast();

  const { group, jobsPage, loading, error, isCompleted, fetchJobs } = useGroupDetail(groupId!, queueName);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: errorOpen, onToggle: toggleError } = useDisclosure({ defaultIsOpen: true });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [draining, setDraining] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [movingToDlq, setMovingToDlq] = useState(false);

  if (loading && !group) {
    return (
      <Box p={6} textAlign="center">
        <Spinner size="lg" color="#00f0ff" />
      </Box>
    );
  }

  if (error && !group) {
    return (
      <Box p={6}>
        <Text color="#ff0033">Error: {error}</Text>
      </Box>
    );
  }

  if (isCompleted) {
    return (
      <Box p={6}>
        <HStack mb={1}>
          <Text
            as={Link}
            to="/"
            fontSize="sm"
            color="#00f0ff"
            textTransform="uppercase"
            letterSpacing="0.1em"
            _hover={{ textDecoration: "underline", textShadow: "0 0 8px rgba(0, 240, 255, 0.3)" }}
          >
            Dashboard
          </Text>
          <Text fontSize="sm" color="#4a6a7a">/</Text>
        </HStack>
        <HStack mb={4} align="center">
          <Text
            fontSize="xl"
            fontWeight="bold"
            fontFamily="mono"
            color="#4a6a7a"
          >
            {groupId}
          </Text>
          <Badge bg="rgba(0, 255, 65, 0.12)" color="#00ff41" fontSize="11px" borderRadius="2px">
            COMPLETED
          </Badge>
        </HStack>

        {group?.displayName && (
          <HStack spacing={6} mb={6} fontSize="sm" color="#4a6a7a">
            <Text>Queue: <Text as="span" color="#b0c4d8">{group.displayName}</Text></Text>
          </HStack>
        )}

        <Text color="#4a6a7a">
          This group has completed processing.
        </Text>
      </Box>
    );
  }

  if (!group) return null;

  const handleUnblock = async () => {
    if (!queueName) return;
    try {
      await apiPost("/api/actions/unblock", { queueName, groupId });
      toast({ title: "Group unblocked", status: "success", duration: 2000, isClosable: true });
    } catch (err) {
      toast({ title: "Failed to unblock", description: err instanceof Error ? err.message : "Unknown error", status: "error", duration: 4000, isClosable: true });
    }
  };

  const handleRetry = async () => {
    if (!queueName || !group?.activeJobId) return;
    setRetrying(true);
    try {
      await apiPost("/api/actions/retry-blocked", { queueName, groupId, jobId: group.activeJobId });
      toast({ title: "Job retried and group unblocked", status: "success", duration: 2000, isClosable: true });
    } catch (err) {
      toast({ title: "Failed to retry", description: err instanceof Error ? err.message : "Unknown error", status: "error", duration: 4000, isClosable: true });
    } finally {
      setRetrying(false);
    }
  };

  const handleMoveToDlq = async () => {
    if (!queueName) return;
    setMovingToDlq(true);
    try {
      await apiPost("/api/actions/move-to-dlq", { queueName, groupId });
      toast({ title: "Group moved to DLQ", status: "success", duration: 2000, isClosable: true });
    } catch (err) {
      toast({ title: "Failed to move to DLQ", description: err instanceof Error ? err.message : "Unknown error", status: "error", duration: 4000, isClosable: true });
    } finally {
      setMovingToDlq(false);
    }
  };

  const handleDrain = async () => {
    if (!queueName) return;
    setDraining(true);
    try {
      await apiPost("/api/actions/drain-group", { queueName, groupId });
      onClose();
    } finally {
      setDraining(false);
    }
  };

  return (
    <Box p={6}>
      <HStack mb={1}>
        <Text
          as={Link}
          to="/"
          fontSize="sm"
          color="#00f0ff"
          textTransform="uppercase"
          letterSpacing="0.1em"
          _hover={{ textDecoration: "underline", textShadow: "0 0 8px rgba(0, 240, 255, 0.3)" }}
        >
          Dashboard
        </Text>
        <Text fontSize="sm" color="#4a6a7a">/</Text>
      </HStack>

      <HStack mb={4} align="center">
        <Text
          fontSize="xl"
          fontWeight="bold"
          fontFamily="mono"
          color="#00f0ff"
          textShadow="0 0 10px rgba(0, 240, 255, 0.2)"
        >
          {groupId}
        </Text>
        {group.isBlocked && (
          <Badge
            bg={group.isStaleBlock ? "rgba(255, 170, 0, 0.12)" : "rgba(255, 0, 51, 0.15)"}
            color={group.isStaleBlock ? "#ffaa00" : "#ff0033"}
            fontSize="11px"
            borderRadius="2px"
          >
            {group.isStaleBlock ? "STALE" : "BLOCKED"}
          </Badge>
        )}
        {!group.isBlocked && (
          <Badge bg="rgba(0, 255, 65, 0.12)" color="#00ff41" fontSize="11px" borderRadius="2px">
            OK
          </Badge>
        )}
      </HStack>

      <HStack spacing={6} mb={6} fontSize="sm" color="#4a6a7a" flexWrap="wrap">
        <Text>Queue: <Text as="span" color="#b0c4d8">{group.displayName}</Text></Text>
        {group.pipelineName && <Text>Pipeline: <Text as="span" color="#b0c4d8">{group.pipelineName}</Text></Text>}
        {group.jobType && <Text>Type: <Text as="span" color="#b0c4d8">{group.jobType}</Text></Text>}
        <Text>Pending: <Text as="span" color="#00f0ff">{group.pendingJobs}</Text></Text>
        {group.activeJobId && (
          <Text>Active: <Text as="span" fontFamily="mono" color="#00ff41">{group.activeJobId}</Text></Text>
        )}
        {group.errorTimestamp && (
          <Text>{group.isBlocked ? "Blocked for" : "Error"}: <Text as="span" color={group.isBlocked ? "#ff0033" : "#ffaa00"}>
            {(() => {
              const ms = Date.now() - group.errorTimestamp;
              if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
              if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
              return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m ago`;
            })()}
          </Text></Text>
        )}
        {group.retryCount !== null && group.retryCount > 0 && (
          <Text>Retries: <Text as="span" color="#ffaa00">{group.retryCount}</Text></Text>
        )}
      </HStack>

      {/* Error display — shown for blocked groups AND non-blocked groups with a last error */}
      {group.errorMessage && (
        <Box
          mb={4}
          border="1px solid"
          borderColor={group.isBlocked ? "rgba(255, 0, 51, 0.2)" : "rgba(255, 170, 0, 0.15)"}
          borderRadius="2px"
          overflow="hidden"
          opacity={group.isBlocked ? 1 : 0.7}
        >
          <HStack
            px={4}
            py={3}
            cursor="pointer"
            onClick={toggleError}
            _hover={{ bg: group.isBlocked ? "rgba(255, 0, 51, 0.04)" : "rgba(255, 170, 0, 0.04)" }}
            userSelect="none"
          >
            <Box color={group.isBlocked ? "#ff0033" : "#ffaa00"} fontSize="xs">
              {errorOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </Box>
            <Text fontSize="sm" color={group.isBlocked ? "#ff0033" : "#ffaa00"} textTransform="uppercase" letterSpacing="0.1em" fontWeight="600">
              {group.isBlocked ? "Block Error" : "Last Error"}
            </Text>
          </HStack>
          <Collapse in={errorOpen}>
            <VStack align="stretch" spacing={2} px={4} pb={4}>
              <Text fontSize="sm" color={group.isBlocked ? "#ff6666" : "#cc9944"} wordBreak="break-all">
                {group.errorMessage}
              </Text>
              {group.errorStack && (
                <Code
                  display="block"
                  whiteSpace="pre-wrap"
                  wordBreak="break-all"
                  p={3}
                  bg="#060a12"
                  border="1px solid"
                  borderColor={group.isBlocked ? "rgba(255, 0, 51, 0.1)" : "rgba(255, 170, 0, 0.1)"}
                  borderRadius="2px"
                  fontSize="11px"
                  color={group.isBlocked ? "#cc6666" : "#aa8844"}
                  maxH="300px"
                  overflow="auto"
                >
                  {group.errorStack}
                </Code>
              )}
            </VStack>
          </Collapse>
        </Box>
      )}

      <HStack spacing={2} mb={6}>
        {group.isBlocked && group.activeJobId && (
          <Button
            size="sm"
            variant="outline"
            color="#ffaa00"
            borderColor="rgba(255, 170, 0, 0.3)"
            borderRadius="2px"
            _hover={{ borderColor: "#ffaa00", boxShadow: "0 0 8px rgba(255, 170, 0, 0.3)" }}
            onClick={handleRetry}
            isLoading={retrying}
          >
            Retry
          </Button>
        )}
        {group.isBlocked && (
          <Button
            size="sm"
            variant="outline"
            color="#00f0ff"
            borderColor="rgba(0, 240, 255, 0.3)"
            borderRadius="2px"
            _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.3)" }}
            onClick={handleUnblock}
          >
            Unblock
          </Button>
        )}
        {group.isBlocked && (
          <Button
            size="sm"
            variant="outline"
            color="#ffaa00"
            borderColor="rgba(255, 170, 0, 0.3)"
            borderRadius="2px"
            _hover={{ borderColor: "#ffaa00", boxShadow: "0 0 8px rgba(255, 170, 0, 0.3)" }}
            onClick={handleMoveToDlq}
            isLoading={movingToDlq}
          >
            Move to DLQ
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          color="#ff0033"
          borderColor="rgba(255, 0, 51, 0.3)"
          borderRadius="2px"
          _hover={{ borderColor: "#ff0033", boxShadow: "0 0 8px rgba(255, 0, 51, 0.3)" }}
          onClick={onOpen}
        >
          Drain Group
        </Button>
      </HStack>

      <Text
        fontSize="sm"
        fontWeight="600"
        color="#00f0ff"
        mb={3}
        textTransform="uppercase"
        letterSpacing="0.15em"
      >
        // Staged Jobs
      </Text>

      {jobsPage ? (
        <JobList
          jobs={jobsPage.jobs}
          total={jobsPage.total}
          page={jobsPage.page}
          totalPages={jobsPage.totalPages}
          onPageChange={(p) => fetchJobs(p)}
          queueName={queueName}
          groupId={groupId}
        />
      ) : (
        <Text color="#4a6a7a" textTransform="uppercase">Loading jobs...</Text>
      )}

      <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onClose}>
        <AlertDialogOverlay>
          <AlertDialogContent bg="#0a0e17" border="1px solid rgba(255, 0, 51, 0.3)" borderRadius="2px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="#ff0033" textTransform="uppercase">
              Drain Group
            </AlertDialogHeader>
            <AlertDialogBody color="#b0c4d8">
              This will remove all staged jobs for group <Text as="span" fontFamily="mono" color="#ff0033">{groupId}</Text>. This cannot be undone.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onClose} variant="ghost" color="#6a8a9a">Cancel</Button>
              <Button
                bg="rgba(255, 0, 51, 0.2)"
                color="#ff0033"
                border="1px solid rgba(255, 0, 51, 0.3)"
                _hover={{ bg: "rgba(255, 0, 51, 0.3)", boxShadow: "0 0 12px rgba(255, 0, 51, 0.3)" }}
                onClick={handleDrain}
                isLoading={draining}
                ml={3}
              >
                Drain
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
}
