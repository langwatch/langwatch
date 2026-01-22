import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import type IORedis from "ioredis";
import type { Job } from "bullmq";
import { getFailedJobs, discoverQueues } from "../lib/queues.js";

interface FailedJobsProps {
  connection: IORedis;
  onBack: () => void;
  onInspectJob: (jobId: string) => void;
  onRequeueJob: (jobId: string) => void;
}

interface FailedJob {
  queue: string;
  job: Job;
}

export const FailedJobs: React.FC<FailedJobsProps> = ({
  connection,
  onBack,
  onInspectJob,
  onRequeueJob,
}) => {
  const [loading, setLoading] = useState(true);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const visibleCount = 15;

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onBack();
    } else if (key.upArrow && selectedIndex > 0) {
      const newIndex = selectedIndex - 1;
      setSelectedIndex(newIndex);
      if (newIndex < scrollOffset) {
        setScrollOffset(newIndex);
      }
    } else if (key.downArrow && selectedIndex < failedJobs.length - 1) {
      const newIndex = selectedIndex + 1;
      setSelectedIndex(newIndex);
      if (newIndex >= scrollOffset + visibleCount) {
        setScrollOffset(newIndex - visibleCount + 1);
      }
    } else if (key.return && failedJobs.length > 0) {
      const job = failedJobs[selectedIndex];
      if (job?.job.id) {
        onInspectJob(job.job.id);
      }
    } else if (input === "r" && failedJobs.length > 0) {
      const job = failedJobs[selectedIndex];
      if (job?.job.id) {
        onRequeueJob(job.job.id);
      }
    } else if (input === "R") {
      loadFailedJobs();
    }
  });

  const loadFailedJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const queues = await discoverQueues(connection);
      const allFailed: FailedJob[] = [];

      for (const queueName of queues) {
        const jobs = await getFailedJobs(queueName, connection, 0, 100);
        for (const job of jobs) {
          allFailed.push({ queue: queueName, job });
        }
      }

      // Sort by timestamp descending (newest first)
      allFailed.sort((a, b) => b.job.timestamp - a.job.timestamp);

      setFailedJobs(allFailed);
      setSelectedIndex(0);
      setScrollOffset(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFailedJobs();
  }, []);

  if (loading) {
    return (
      <Box padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Loading failed jobs...
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          Error: {error}
        </Text>
        <Text dimColor>Press Escape or q to go back</Text>
      </Box>
    );
  }

  if (failedJobs.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green">No failed jobs found. 🎉</Text>
        <Box marginTop={1}>
          <Text dimColor>Press R to refresh, Escape or q to go back</Text>
        </Box>
      </Box>
    );
  }

  const visibleJobs = failedJobs.slice(scrollOffset, scrollOffset + visibleCount);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="red">
          📛 Failed Jobs ({failedJobs.length})
        </Text>
      </Box>

      {/* Header */}
      <Box>
        <Box width={3}>
          <Text bold> </Text>
        </Box>
        <Box width={25}>
          <Text bold>Queue</Text>
        </Box>
        <Box width={20}>
          <Text bold>Job ID</Text>
        </Box>
        <Box width={10}>
          <Text bold>Attempts</Text>
        </Box>
        <Box width={40}>
          <Text bold>Error</Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>{"─".repeat(98)}</Text>
      </Box>

      {visibleJobs.map((item, visibleIndex) => {
        const actualIndex = scrollOffset + visibleIndex;
        const isSelected = actualIndex === selectedIndex;
        const errorPreview = item.job.failedReason
          ? item.job.failedReason.substring(0, 38) +
            (item.job.failedReason.length > 38 ? "..." : "")
          : "N/A";

        return (
          <Box key={`${item.queue}-${item.job.id}`}>
            <Box width={3}>
              <Text color={isSelected ? "cyan" : undefined}>
                {isSelected ? "▶" : " "}
              </Text>
            </Box>
            <Box width={25}>
              <Text color={isSelected ? "cyan" : undefined}>
                {item.queue.length > 23 ? item.queue.substring(0, 20) + "..." : item.queue}
              </Text>
            </Box>
            <Box width={20}>
              <Text color={isSelected ? "cyan" : undefined}>
                {item.job.id?.substring(0, 18) ?? "N/A"}
              </Text>
            </Box>
            <Box width={10}>
              <Text color={isSelected ? "cyan" : undefined}>
                {item.job.attemptsMade}/{item.job.opts.attempts ?? "∞"}
              </Text>
            </Box>
            <Box width={40}>
              <Text color="red">{errorPreview}</Text>
            </Box>
          </Box>
        );
      })}

      {failedJobs.length > visibleCount && (
        <Box marginTop={1}>
          <Text dimColor>
            Showing {scrollOffset + 1}-{Math.min(scrollOffset + visibleCount, failedJobs.length)} of{" "}
            {failedJobs.length}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate, Enter to inspect, r to requeue selected, R to refresh, q to go back
        </Text>
      </Box>
    </Box>
  );
};
