import { Box, Text, HStack, VStack, Badge, Button, Code, Spinner, Tooltip, useDisclosure, useToast,
  AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader,
  AlertDialogBody, AlertDialogFooter,
} from "@chakra-ui/react";
import { useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useGroupDetail } from "../hooks/useGroupDetail.ts";
import { JobList } from "../components/jobs/JobList.tsx";
import { apiPost } from "../hooks/useApi.ts";
import type { BullMQJob } from "../../shared/types.ts";
import { timeAgo } from "../utils/timeAgo.ts";
import { CopyButton } from "../components/CopyButton.tsx";

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams] = useSearchParams();
  const queueName = searchParams.get("queue") ?? undefined;
  const toast = useToast();

  const { group, jobsPage, completedJobs, loading, error, isCompleted, fetchJobs } = useGroupDetail(groupId!, queueName);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [draining, setDraining] = useState(false);

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

        {completedJobs.length > 0 ? (
          <>
            <Text
              fontSize="sm"
              fontWeight="600"
              color="#00f0ff"
              mb={3}
              textTransform="uppercase"
              letterSpacing="0.15em"
            >
              // Completed Jobs ({completedJobs.length})
            </Text>
            <VStack spacing={2} align="stretch">
              {completedJobs.map((job) => (
                <CompletedJobCard key={job.id} job={job} />
              ))}
            </VStack>
          </>
        ) : (
          <Text color="#4a6a7a">
            This group has completed processing. No recent completed jobs retained.
          </Text>
        )}
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

      <HStack spacing={6} mb={6} fontSize="sm" color="#4a6a7a">
        <Text>Queue: <Text as="span" color="#b0c4d8">{group.displayName}</Text></Text>
        {group.pipelineName && <Text>Pipeline: <Text as="span" color="#b0c4d8">{group.pipelineName}</Text></Text>}
        {group.jobType && <Text>Type: <Text as="span" color="#b0c4d8">{group.jobType}</Text></Text>}
        <Text>Pending: <Text as="span" color="#00f0ff">{group.pendingJobs}</Text></Text>
        {group.activeJobId && (
          <Text>Active: <Text as="span" fontFamily="mono" color="#00ff41">{group.activeJobId}</Text></Text>
        )}
      </HStack>

      <HStack spacing={2} mb={6}>
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

function CompletedJobCard({ job }: { job: BullMQJob }) {
  const { isOpen, onToggle } = useDisclosure();

  return (
    <Box
      bg="#0a0e17"
      borderRadius="2px"
      border="1px solid"
      borderColor="rgba(0, 255, 65, 0.15)"
      boxShadow="0 0 6px rgba(0, 255, 65, 0.06)"
      overflow="hidden"
    >
      <HStack px={4} py={3} cursor="pointer" onClick={onToggle} _hover={{ bg: "rgba(0, 255, 65, 0.04)" }}>
        <Badge bg="rgba(0, 255, 65, 0.12)" color="#00ff41" fontSize="9px" borderRadius="2px">
          COMPLETED
        </Badge>
        <Tooltip label={job.id} openDelay={200}>
          <Text fontFamily="mono" fontSize="xs" color="#6a8a9a" maxW="300px" isTruncated>
            {job.id}
          </Text>
        </Tooltip>
        <CopyButton value={job.id} />
        <Text fontFamily="mono" fontSize="xs" color="#4a6a7a">{job.name}</Text>
        <Text fontSize="xs" color="#4a6a7a" ml="auto">
          {job.finishedOn ? timeAgo(job.finishedOn) : timeAgo(job.timestamp)}
        </Text>
      </HStack>
      {isOpen && (
        <Box px={4} pb={3} borderTop="1px solid rgba(0, 255, 65, 0.08)">
          <VStack align="stretch" spacing={2} pt={2}>
            <HStack fontSize="xs">
              <Text color="#4a6a7a" w="90px" textTransform="uppercase">Attempts</Text>
              <Text color="#b0c4d8">{job.attemptsMade}</Text>
            </HStack>
            {job.processedOn && (
              <HStack fontSize="xs">
                <Text color="#4a6a7a" w="90px" textTransform="uppercase">Processed</Text>
                <Text color="#b0c4d8">{new Date(job.processedOn).toISOString()}</Text>
              </HStack>
            )}
            {job.finishedOn && (
              <HStack fontSize="xs">
                <Text color="#4a6a7a" w="90px" textTransform="uppercase">Finished</Text>
                <Text color="#b0c4d8">{new Date(job.finishedOn).toISOString()}</Text>
              </HStack>
            )}
            {job.returnvalue != null && (
              <Box>
                <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" mb={1}>Return Value</Text>
                <Code
                  display="block"
                  whiteSpace="pre-wrap"
                  wordBreak="break-all"
                  p={3}
                  bg="#060a12"
                  border="1px solid rgba(0, 255, 65, 0.1)"
                  borderRadius="2px"
                  fontSize="11px"
                  color="#00ff41"
                  maxH="200px"
                  overflow="auto"
                >
                  {typeof job.returnvalue === "string" ? job.returnvalue : JSON.stringify(job.returnvalue, null, 2)}
                </Code>
              </Box>
            )}
            <Box>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" mb={1}>Data</Text>
              <Code
                display="block"
                whiteSpace="pre-wrap"
                wordBreak="break-all"
                p={3}
                bg="#060a12"
                border="1px solid rgba(0, 240, 255, 0.1)"
                borderRadius="2px"
                fontSize="11px"
                color="#00f0ff"
                maxH="300px"
                overflow="auto"
              >
                {JSON.stringify(job.data, null, 2)}
              </Code>
            </Box>
          </VStack>
        </Box>
      )}
    </Box>
  );
}
