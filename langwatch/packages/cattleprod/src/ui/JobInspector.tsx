import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type IORedis from "ioredis";
import { getJob, discoverQueues, type JobInfo } from "../lib/queues.js";

interface JobInspectorProps {
  connection: IORedis;
  initialJobId?: string;
  onBack: () => void;
  onRequeue: (jobId: string) => void;
}

type State =
  | { type: "input" }
  | { type: "loading"; jobId: string }
  | { type: "result"; job: JobInfo; queueName: string }
  | { type: "not-found"; jobId: string }
  | { type: "error"; message: string };

export const JobInspector: React.FC<JobInspectorProps> = ({
  connection,
  initialJobId,
  onBack,
  onRequeue,
}) => {
  const [state, setState] = useState<State>(
    initialJobId ? { type: "loading", jobId: initialJobId } : { type: "input" }
  );
  const [inputValue, setInputValue] = useState("");
  const [scrollOffset, setScrollOffset] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      if (state.type === "result" || state.type === "not-found" || state.type === "error") {
        setState({ type: "input" });
        setScrollOffset(0);
      } else {
        onBack();
      }
    } else if (input === "q" && state.type !== "input") {
      onBack();
    } else if (input === "r" && state.type === "result") {
      onRequeue(state.job.id);
    } else if (key.downArrow && state.type === "result") {
      setScrollOffset((prev) => prev + 1);
    } else if (key.upArrow && state.type === "result") {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    }
  });

  const searchJob = async (jobId: string) => {
    setState({ type: "loading", jobId });

    try {
      const queues = await discoverQueues(connection);

      for (const queueName of queues) {
        const job = await getJob(queueName, jobId, connection);
        if (job) {
          setState({ type: "result", job, queueName });
          return;
        }
      }

      setState({ type: "not-found", jobId });
    } catch (err) {
      setState({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  useEffect(() => {
    if (initialJobId) {
      searchJob(initialJobId);
    }
  }, [initialJobId]);

  const handleSubmit = (value: string) => {
    if (value.trim()) {
      searchJob(value.trim());
    }
  };

  const formatTimestamp = (ts?: number): string => {
    if (!ts) return "N/A";
    return new Date(ts).toISOString();
  };

  const formatState = (jobState: string): React.ReactNode => {
    const colors: Record<string, string> = {
      completed: "green",
      failed: "red",
      active: "cyan",
      waiting: "yellow",
      delayed: "magenta",
    };
    return <Text color={colors[jobState] || undefined}>{jobState}</Text>;
  };

  if (state.type === "input") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            🔍 Job Inspector
          </Text>
        </Box>
        <Box>
          <Text>Enter Job ID: </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            placeholder="job-id-here"
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to search, Escape to go back</Text>
        </Box>
      </Box>
    );
  }

  if (state.type === "loading") {
    return (
      <Box padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Searching for job {state.jobId}...
        </Text>
      </Box>
    );
  }

  if (state.type === "not-found") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Job "{state.jobId}" not found in any queue.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Escape to search again, q to go back</Text>
        </Box>
      </Box>
    );
  }

  if (state.type === "error") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          Error: {state.message}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>Press Escape to try again, q to go back</Text>
        </Box>
      </Box>
    );
  }

  const { job, queueName } = state;
  const backoff = job.opts.backoff as { type?: string; delay?: number } | undefined;

  const dataLines = JSON.stringify(job.data, null, 2).split("\n");
  const visibleLines = dataLines.slice(scrollOffset, scrollOffset + 15);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="green">
          ✓ Found in queue: {queueName}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>═══ Job Info ═══</Text>
        <Text>
          <Text dimColor>ID:        </Text>
          {job.id}
        </Text>
        <Text>
          <Text dimColor>Name:      </Text>
          {job.name}
        </Text>
        <Text>
          <Text dimColor>State:     </Text>
          {formatState(job.state)}
        </Text>
        <Text>
          <Text dimColor>Attempts:  </Text>
          {job.attemptsMade}/{(job.opts.attempts as number) ?? "∞"}
        </Text>
        <Text>
          <Text dimColor>Created:   </Text>
          {formatTimestamp(job.timestamp)}
        </Text>
        <Text>
          <Text dimColor>Processed: </Text>
          {formatTimestamp(job.processedOn)}
        </Text>
        <Text>
          <Text dimColor>Finished:  </Text>
          {formatTimestamp(job.finishedOn)}
        </Text>
        {backoff && typeof backoff === "object" && (
          <Text>
            <Text dimColor>Backoff:   </Text>
            {backoff.type ?? "unknown"} ({backoff.delay ?? 0}ms)
          </Text>
        )}
      </Box>

      {job.failedReason && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="red">
            ═══ Error ═══
          </Text>
          <Text color="red">{job.failedReason}</Text>
        </Box>
      )}

      {job.stacktrace && job.stacktrace.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="red">
            ═══ Stack Trace ═══
          </Text>
          {job.stacktrace.slice(0, 5).map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
          {job.stacktrace.length > 5 && (
            <Text dimColor>... {job.stacktrace.length - 5} more lines</Text>
          )}
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>═══ Job Data ═══</Text>
        {visibleLines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
        {dataLines.length > 15 && (
          <Text dimColor>
            (Showing {scrollOffset + 1}-{Math.min(scrollOffset + 15, dataLines.length)} of{" "}
            {dataLines.length} lines, use ↑↓ to scroll)
          </Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {job.state === "failed" ? "r to requeue, " : ""}Escape to search again, q to go back
        </Text>
      </Box>
    </Box>
  );
};
