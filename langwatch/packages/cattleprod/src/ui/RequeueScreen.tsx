import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import type IORedis from "ioredis";
import type { Job } from "bullmq";
import {
  requeueJob,
  requeueFailedJobs,
  getFailedJobs,
  discoverQueues,
  getJob,
} from "../lib/queues.js";

interface RequeueScreenProps {
  connection: IORedis;
  initialJobId?: string;
  onBack: () => void;
}

type Mode = "select" | "single" | "queue" | "all";

type State =
  | { type: "select-mode" }
  | { type: "input-job-id" }
  | { type: "select-queue"; queues: string[] }
  | { type: "confirm"; mode: Mode; target: string; count: number }
  | { type: "processing"; mode: Mode; target: string }
  | { type: "done"; requeued: number; total: number; errors: string[] }
  | { type: "error"; message: string };

const modeItems = [
  { label: "Single job by ID", value: "single" },
  { label: "All failed jobs in a queue", value: "queue" },
  { label: "All failed jobs (all queues)", value: "all" },
  { label: "← Back", value: "back" },
];

export const RequeueScreen: React.FC<RequeueScreenProps> = ({
  connection,
  initialJobId,
  onBack,
}) => {
  const [state, setState] = useState<State>(
    initialJobId
      ? { type: "confirm", mode: "single", target: initialJobId, count: 1 }
      : { type: "select-mode" }
  );
  const [inputValue, setInputValue] = useState("");
  const [queues, setQueues] = useState<string[]>([]);

  useInput((input, key) => {
    if (key.escape) {
      if (state.type === "done" || state.type === "error") {
        onBack();
      } else if (state.type !== "select-mode" && state.type !== "processing") {
        setState({ type: "select-mode" });
      } else if (state.type === "select-mode") {
        onBack();
      }
    } else if (input === "q" && state.type !== "input-job-id") {
      onBack();
    }
  });

  const loadQueues = async () => {
    const discovered = await discoverQueues(connection);
    setQueues(discovered);
    return discovered;
  };

  const countFailedInQueue = async (queueName: string): Promise<number> => {
    const jobs = await getFailedJobs(queueName, connection, 0, -1);
    return jobs.length;
  };

  const countAllFailed = async (): Promise<number> => {
    const discovered = await loadQueues();
    let total = 0;
    for (const q of discovered) {
      total += await countFailedInQueue(q);
    }
    return total;
  };

  const handleModeSelect = async (item: { value: string }) => {
    if (item.value === "back") {
      onBack();
      return;
    }

    if (item.value === "single") {
      setState({ type: "input-job-id" });
    } else if (item.value === "queue") {
      const discovered = await loadQueues();
      setState({ type: "select-queue", queues: discovered });
    } else if (item.value === "all") {
      const count = await countAllFailed();
      setState({ type: "confirm", mode: "all", target: "all queues", count });
    }
  };

  const handleJobIdSubmit = async (value: string) => {
    const jobId = value.trim();
    if (!jobId) return;

    // Verify job exists
    const discovered = await loadQueues();
    for (const q of discovered) {
      const job = await getJob(q, jobId, connection);
      if (job) {
        setState({ type: "confirm", mode: "single", target: jobId, count: 1 });
        return;
      }
    }

    setState({ type: "error", message: `Job "${jobId}" not found in any queue` });
  };

  const handleQueueSelect = async (item: { value: string }) => {
    if (item.value === "back") {
      setState({ type: "select-mode" });
      return;
    }

    const count = await countFailedInQueue(item.value);
    setState({ type: "confirm", mode: "queue", target: item.value, count });
  };

  const handleConfirm = async (confirmed: boolean) => {
    if (!confirmed) {
      setState({ type: "select-mode" });
      return;
    }

    if (state.type !== "confirm") return;

    setState({ type: "processing", mode: state.mode, target: state.target });

    try {
      if (state.mode === "single") {
        // Find the queue for this job
        const discovered = await loadQueues();
        for (const q of discovered) {
          const result = await requeueJob(state.target, state.target, connection, {
            resetAttempts: true,
          });
          if (result.success) {
            setState({ type: "done", requeued: 1, total: 1, errors: [] });
            return;
          }
        }

        // Try to find and requeue
        for (const q of discovered) {
          const job = await getJob(q, state.target, connection);
          if (job) {
            const result = await requeueJob(q, state.target, connection, {
              resetAttempts: true,
            });
            if (result.success) {
              setState({ type: "done", requeued: 1, total: 1, errors: [] });
            } else {
              setState({ type: "error", message: result.error ?? "Unknown error" });
            }
            return;
          }
        }

        setState({ type: "error", message: "Job not found" });
      } else if (state.mode === "queue") {
        const result = await requeueFailedJobs(state.target, connection, {
          resetAttempts: true,
        });
        setState({
          type: "done",
          requeued: result.requeued,
          total: result.total,
          errors: result.errors,
        });
      } else if (state.mode === "all") {
        let totalRequeued = 0;
        let totalJobs = 0;
        const allErrors: string[] = [];

        for (const q of queues) {
          const result = await requeueFailedJobs(q, connection, {
            resetAttempts: true,
          });
          totalRequeued += result.requeued;
          totalJobs += result.total;
          allErrors.push(...result.errors);
        }

        setState({
          type: "done",
          requeued: totalRequeued,
          total: totalJobs,
          errors: allErrors,
        });
      }
    } catch (err) {
      setState({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  if (state.type === "select-mode") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            🔄 Requeue Failed Jobs
          </Text>
        </Box>
        <SelectInput items={modeItems} onSelect={handleModeSelect} />
        <Box marginTop={1}>
          <Text dimColor>Requeued jobs will have their attempt counter reset</Text>
        </Box>
      </Box>
    );
  }

  if (state.type === "input-job-id") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            🔄 Requeue Single Job
          </Text>
        </Box>
        <Box>
          <Text>Enter Job ID: </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleJobIdSubmit}
            placeholder="job-id-here"
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to continue, Escape to go back</Text>
        </Box>
      </Box>
    );
  }

  if (state.type === "select-queue") {
    const queueItems = [
      ...state.queues.map((q) => ({ label: q, value: q })),
      { label: "← Back", value: "back" },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            🔄 Select Queue
          </Text>
        </Box>
        <SelectInput items={queueItems} onSelect={handleQueueSelect} />
      </Box>
    );
  }

  if (state.type === "confirm") {
    const confirmItems = [
      { label: `Yes, requeue ${state.count} job(s)`, value: "yes" },
      { label: "No, cancel", value: "no" },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            ⚠️ Confirm Requeue
          </Text>
        </Box>
        <Text>
          Requeue {state.count} failed job(s) from {state.target}?
        </Text>
        <Text dimColor>Attempt counters will be reset.</Text>
        <Box marginTop={1}>
          <SelectInput
            items={confirmItems}
            onSelect={(item) => handleConfirm(item.value === "yes")}
          />
        </Box>
      </Box>
    );
  }

  if (state.type === "processing") {
    return (
      <Box padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Requeuing jobs from {state.target}...
        </Text>
      </Box>
    );
  }

  if (state.type === "done") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">
          ✓ Requeued {state.requeued}/{state.total} jobs
        </Text>
        {state.errors.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="red">{state.errors.length} errors:</Text>
            {state.errors.slice(0, 5).map((err, i) => (
              <Text key={i} color="red" dimColor>
                - {err}
              </Text>
            ))}
            {state.errors.length > 5 && (
              <Text dimColor>... and {state.errors.length - 5} more</Text>
            )}
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Press Escape or q to go back</Text>
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

  return null;
};
