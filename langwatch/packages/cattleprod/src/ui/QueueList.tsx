import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import type IORedis from "ioredis";
import { getAllQueueStats, type QueueStats } from "../lib/queues.js";

interface QueueListProps {
  connection: IORedis;
  onBack: () => void;
  onInspectJob: (jobId: string) => void;
}

export const QueueList: React.FC<QueueListProps> = ({
  connection,
  onBack,
}) => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<QueueStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onBack();
    } else if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < stats.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    } else if (input === "r") {
      loadStats();
    }
  });

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const queueStats = await getAllQueueStats(connection);
      setStats(queueStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  if (loading) {
    return (
      <Box padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Discovering queues...
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
        <Text dimColor>Press Escape or q to go back, r to retry</Text>
      </Box>
    );
  }

  if (stats.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">No queues found.</Text>
        <Text dimColor>Press Escape or q to go back, r to refresh</Text>
      </Box>
    );
  }

  // Calculate column widths
  const nameWidth = Math.max(20, ...stats.map((s) => s.name.length)) + 2;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          📋 Queue List ({stats.length} queues)
        </Text>
      </Box>

      {/* Header */}
      <Box>
        <Box width={nameWidth}>
          <Text bold>Queue</Text>
        </Box>
        <Box width={10}>
          <Text bold color="cyan">Wait</Text>
        </Box>
        <Box width={10}>
          <Text bold color="green">Active</Text>
        </Box>
        <Box width={12}>
          <Text bold color="blue">Done</Text>
        </Box>
        <Box width={10}>
          <Text bold color="red">Failed</Text>
        </Box>
        <Box width={10}>
          <Text bold color="yellow">Delay</Text>
        </Box>
      </Box>

      {/* Separator */}
      <Box marginBottom={1}>
        <Text dimColor>{"─".repeat(nameWidth + 52)}</Text>
      </Box>

      {/* Rows */}
      {stats.map((stat, index) => (
        <Box key={stat.name}>
          <Box width={nameWidth}>
            <Text
              color={index === selectedIndex ? "cyan" : undefined}
              bold={index === selectedIndex}
            >
              {index === selectedIndex ? "▶ " : "  "}
              {stat.name}
            </Text>
          </Box>
          <Box width={10}>
            <Text color={stat.waiting > 0 ? "cyan" : "gray"}>
              {stat.waiting}
            </Text>
          </Box>
          <Box width={10}>
            <Text color={stat.active > 0 ? "green" : "gray"}>
              {stat.active}
            </Text>
          </Box>
          <Box width={12}>
            <Text color="gray">{stat.completed}</Text>
          </Box>
          <Box width={10}>
            <Text color={stat.failed > 0 ? "red" : "gray"}>
              {stat.failed}
            </Text>
          </Box>
          <Box width={10}>
            <Text color={stat.delayed > 0 ? "yellow" : "gray"}>
              {stat.delayed}
            </Text>
          </Box>
        </Box>
      ))}

      {/* Summary */}
      <Box marginTop={1}>
        <Text dimColor>
          Total: {stats.reduce((a, s) => a + s.waiting, 0)} waiting,{" "}
          {stats.reduce((a, s) => a + s.active, 0)} active,{" "}
          {stats.reduce((a, s) => a + s.failed, 0)} failed
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Press r to refresh, Escape or q to go back
        </Text>
      </Box>
    </Box>
  );
};
