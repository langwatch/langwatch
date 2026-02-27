import { Box, Text, HStack, Badge, Code } from "@chakra-ui/react";
import { useParams, useSearchParams, useLocation, Link } from "react-router-dom";
import type { JobInfo } from "../../shared/types.ts";
import { timeAgo } from "../utils/timeAgo.ts";
import { CopyButton } from "../components/CopyButton.tsx";

interface LocationState {
  job?: JobInfo;
  index?: number;
}

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const state = location.state as LocationState | null;

  const queueName = searchParams.get("queue") ?? undefined;
  const groupId = searchParams.get("group") ?? undefined;
  const job = state?.job;
  const index = state?.index;

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
        {groupId && queueName && (
          <>
            <Text
              as={Link}
              to={`/groups/${encodeURIComponent(groupId)}?queue=${encodeURIComponent(queueName)}`}
              fontSize="sm"
              color="#00f0ff"
              textTransform="uppercase"
              letterSpacing="0.1em"
              _hover={{ textDecoration: "underline", textShadow: "0 0 8px rgba(0, 240, 255, 0.3)" }}
            >
              Group
            </Text>
            <Text fontSize="sm" color="#4a6a7a">/</Text>
          </>
        )}
        <Text fontSize="sm" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em">
          Job
        </Text>
      </HStack>

      <HStack mb={6}>
        <Text
          fontFamily="mono"
          fontSize="md"
          color="#00f0ff"
          wordBreak="break-all"
          textShadow="0 0 10px rgba(0, 240, 255, 0.3)"
        >
          {jobId}
        </Text>
        {jobId && <CopyButton value={jobId} />}
      </HStack>

      <Box
        bg="#0a0e17"
        borderRadius="2px"
        border="1px solid"
        borderColor="rgba(0, 240, 255, 0.25)"
        boxShadow="0 0 15px rgba(0, 240, 255, 0.08)"
        p={5}
      >
        {job ? (
          <>
            {index != null && (
              <HStack mb={3}>
                <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="120px">Index</Text>
                <Text fontSize="xs" color="#6a8a9a">#{index + 1}</Text>
              </HStack>
            )}
            <HStack mb={3} align="flex-start">
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="120px">Staged ID</Text>
              <Text fontFamily="mono" fontSize="xs" color="#6a8a9a" wordBreak="break-all">
                {job.stagedJobId}
              </Text>
              <CopyButton value={job.stagedJobId} />
            </HStack>
            <HStack mb={3}>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="120px">Dispatch</Text>
              <Text fontSize="xs" color="#4a6a7a">
                {timeAgo(job.dispatchAfter)}
                {job.dispatchAfter ? ` (${new Date(job.dispatchAfter).toISOString()})` : ""}
              </Text>
            </HStack>
            {job.data?.__dedupId != null && (
              <HStack mb={3}>
                <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" w="120px">Dedup</Text>
                <Badge fontSize="9px" bg="rgba(0, 240, 255, 0.1)" color="#00f0ff" borderRadius="2px">
                  {String(job.data.__dedupId as string)}
                </Badge>
                <CopyButton value={String(job.data.__dedupId as string)} />
              </HStack>
            )}
            <Box mt={4}>
              <Text fontSize="xs" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em" mb={2}>
                // Job Data
              </Text>
              <Code
                display="block"
                whiteSpace="pre-wrap"
                wordBreak="break-all"
                p={4}
                bg="#060a12"
                border="1px solid rgba(0, 255, 65, 0.1)"
                borderRadius="2px"
                fontSize="12px"
                color="#00ff41"
                maxH="600px"
                overflow="auto"
              >
                {job.data ? JSON.stringify(job.data, null, 2) : "(no data)"}
              </Code>
            </Box>
          </>
        ) : (
          <Box>
            <Text fontSize="sm" color="#6a8a9a" mb={4}>
              Job data is not available (direct URL access). Navigate from the group detail view to see full job data.
            </Text>
            {groupId && queueName && (
              <Text
                as={Link}
                to={`/groups/${encodeURIComponent(groupId)}?queue=${encodeURIComponent(queueName)}`}
                fontSize="sm"
                color="#00f0ff"
                _hover={{ textDecoration: "underline", textShadow: "0 0 8px rgba(0, 240, 255, 0.3)" }}
              >
                Back to Group
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
