import {
  Box, Text, VStack, HStack, Badge, Button, Code, Tooltip,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
  useDisclosure,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import type { JobInfo } from "../../../shared/types.ts";
import { timeAgo } from "../../utils/timeAgo.ts";
import { CopyButton } from "../CopyButton.tsx";

interface JobCardProps {
  job: JobInfo;
  index: number;
  queueName?: string;
  groupId?: string;
}

function JobCard({ job, index, queueName, groupId }: JobCardProps) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const navigate = useNavigate();

  const handleViewFullPage = () => {
    const params = new URLSearchParams();
    if (queueName) params.set("queue", queueName);
    if (groupId) params.set("group", groupId);
    navigate(`/jobs/${encodeURIComponent(job.stagedJobId)}?${params.toString()}`, {
      state: { job, index },
    });
  };

  return (
    <>
      <Box
        bg="#0a0e17"
        borderRadius="2px"
        border="1px solid"
        borderColor="rgba(0, 240, 255, 0.15)"
        boxShadow="0 0 6px rgba(0, 240, 255, 0.06)"
        overflow="hidden"
      >
        <HStack px={4} py={3} cursor="pointer" onClick={onOpen} _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}>
          <Text fontSize="xs" color="#4a6a7a">#{index + 1}</Text>
          <Tooltip label={job.stagedJobId} openDelay={200}>
            <Text fontFamily="mono" fontSize="xs" color="#6a8a9a" maxW="300px" isTruncated>
              {job.stagedJobId}
            </Text>
          </Tooltip>
          <CopyButton value={job.stagedJobId} />
          <Text fontSize="xs" color="#4a6a7a" ml="auto">
            dispatch: {timeAgo(job.dispatchAfter)}
          </Text>
          {job.data?.__dedupId != null && (
            <Badge fontSize="9px" bg="rgba(0, 240, 255, 0.1)" color="#00f0ff" borderRadius="2px">
              dedup: {String(job.data.__dedupId as string)}
            </Badge>
          )}
        </HStack>
      </Box>

      <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered>
        <ModalOverlay bg="rgba(0, 0, 0, 0.7)" />
        <ModalContent
          bg="#0a0e17"
          border="1px solid"
          borderColor="rgba(0, 240, 255, 0.4)"
          boxShadow="0 0 30px rgba(0, 240, 255, 0.15), inset 0 0 20px rgba(0, 240, 255, 0.03)"
          borderRadius="2px"
          maxW="700px"
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
            Job Detail — #{index + 1}
          </ModalHeader>
          <ModalCloseButton color="#4a6a7a" _hover={{ color: "#00f0ff" }} />
          <ModalBody py={4}>
            <VStack align="stretch" spacing={3}>
              <HStack>
                <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="100px">Staged ID</Text>
                <Text fontFamily="mono" fontSize="xs" color="#6a8a9a" wordBreak="break-all">
                  {job.stagedJobId}
                </Text>
                <CopyButton value={job.stagedJobId} />
              </HStack>
              <HStack>
                <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="100px">Dispatch</Text>
                <Text fontSize="xs" color="#4a6a7a">
                  {timeAgo(job.dispatchAfter)}
                  {job.dispatchAfter ? ` (${new Date(job.dispatchAfter).toISOString()})` : ""}
                </Text>
              </HStack>
              {job.data?.__dedupId != null && (
                <HStack>
                  <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="100px">Dedup</Text>
                  <Badge fontSize="9px" bg="rgba(0, 240, 255, 0.1)" color="#00f0ff" borderRadius="2px">
                    {String(job.data.__dedupId as string)}
                  </Badge>
                  <CopyButton value={String(job.data.__dedupId as string)} />
                </HStack>
              )}
              <Box>
                <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" mb={2}>Data</Text>
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
                  maxH="400px"
                  overflow="auto"
                >
                  {job.data ? JSON.stringify(job.data, null, 2) : "(no data)"}
                </Code>
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
                onClick={handleViewFullPage}
                alignSelf="flex-end"
              >
                View Full Page
              </Button>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
}

interface JobListProps {
  jobs: JobInfo[];
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  queueName?: string;
  groupId?: string;
}

export function JobList({ jobs, total, page, totalPages, onPageChange, queueName, groupId }: JobListProps) {
  return (
    <Box>
      <Text fontSize="xs" color="#4a6a7a" mb={3} textTransform="uppercase" letterSpacing="0.1em">
        {total} jobs total (page {page + 1} of {totalPages || 1})
      </Text>
      <VStack spacing={2} align="stretch">
        {jobs.map((job, i) => (
          <JobCard key={job.stagedJobId} job={job} index={page * 50 + i} queueName={queueName} groupId={groupId} />
        ))}
        {jobs.length === 0 && (
          <Text color="#4a6a7a" textAlign="center" py={6} textTransform="uppercase">No jobs</Text>
        )}
      </VStack>
      {totalPages > 1 && (
        <HStack justify="center" mt={4} spacing={2}>
          <Button
            size="sm"
            variant="outline"
            color="#00f0ff"
            borderColor="rgba(0, 240, 255, 0.3)"
            borderRadius="2px"
            _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.2)" }}
            isDisabled={page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <Text fontSize="sm" color="#6a8a9a">
            {page + 1} / {totalPages}
          </Text>
          <Button
            size="sm"
            variant="outline"
            color="#00f0ff"
            borderColor="rgba(0, 240, 255, 0.3)"
            borderRadius="2px"
            _hover={{ borderColor: "#00f0ff", boxShadow: "0 0 8px rgba(0, 240, 255, 0.2)" }}
            isDisabled={page >= totalPages - 1}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </HStack>
      )}
    </Box>
  );
}
