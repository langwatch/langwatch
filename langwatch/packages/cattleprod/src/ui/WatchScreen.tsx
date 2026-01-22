import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import type IORedis from "ioredis";
import { getAllQueueStats, type QueueStats } from "../lib/queues.js";

interface WatchScreenProps {
  connection: IORedis;
  onBack: () => void;
}

export const WatchScreen: React.FC<WatchScreenProps> = ({
  connection,
  onBack,
}) => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<QueueStats[]>([]);
  const [prevStats, setPrevStats] = useState<Map<string, QueueStats>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      onBack();
    } else if (input === " ") {
      setPaused(!paused);
    }
  });

  const loadStats = async () => {
    try {
      const queueStats = await getAllQueueStats(connection);
      setPrevStats(new Map(stats.map((s) => [s.name, s])));
      setStats(queueStats);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    intervalRef.current = setInterval(() => {
      if (!paused) {
        loadStats();
      }
    }, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [paused]);

  const formatDelta = (current: number, previous: number | undefined): React.ReactNode => {
    if (previous === undefined) return null;
    const delta = current - previous;
    if (delta === 0) return null;
    if (delta > 0) {
      return <Text color="green"> (+{delta})</Text>;
    }
    return <Text color="red"> ({delta})</Text>;
  };

  if (loading && stats.length === 0) {
    return (
      <Box padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Loading queues...
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

  const nameWidth = Math.max(20, ...stats.map((s) => s.name.length)) + 2;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color="cyan">
          📊 Queue Monitor {paused ? <Text color="yellow">(PAUSED)</Text> : <Spinner type="dots" />}
        </Text>
        <Text dimColor>
          {lastUpdate ? `Last update: ${lastUpdate.toLocaleTimeString()}` : ""}
        </Text>
      </Box>

      {/* Header */}
      <Box>
        <Box width={nameWidth}>
          <Text bold>Queue</Text>
        </Box>
        <Box width={14}>
          <Text bold color="cyan">Waiting</Text>
        </Box>
        <Box width={14}>
          <Text bold color="green">Active</Text>
        </Box>
        <Box width={14}>
          <Text bold color="blue">Completed</Text>
        </Box>
        <Box width={14}>
          <Text bold color="red">Failed</Text>
        </Box>
        <Box width={14}>
          <Text bold color="yellow">Delayed</Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>{"─".repeat(nameWidth + 70)}</Text>
      </Box>

      {stats.map((stat) => {
        const prev = prevStats.get(stat.name);
        return (
          <Box key={stat.name}>
            <Box width={nameWidth}>
              <Text>{stat.name}</Text>
            </Box>
            <Box width={14}>
              <Text color={stat.waiting > 0 ? "cyan" : "gray"}>
                {stat.waiting}
              </Text>
              {formatDelta(stat.waiting, prev?.waiting)}
            </Box>
            <Box width={14}>
              <Text color={stat.active > 0 ? "green" : "gray"}>
                {stat.active}
              </Text>
              {formatDelta(stat.active, prev?.active)}
            </Box>
            <Box width={14}>
              <Text color="gray">{stat.completed}</Text>
              {formatDelta(stat.completed, prev?.completed)}
            </Box>
            <Box width={14}>
              <Text color={stat.failed > 0 ? "red" : "gray"}>
                {stat.failed}
              </Text>
              {formatDelta(stat.failed, prev?.failed)}
            </Box>
            <Box width={14}>
              <Text color={stat.delayed > 0 ? "yellow" : "gray"}>
                {stat.delayed}
              </Text>
              {formatDelta(stat.delayed, prev?.delayed)}
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>
          Total: {stats.reduce((a, s) => a + s.waiting, 0)} waiting,{" "}
          {stats.reduce((a, s) => a + s.active, 0)} active,{" "}
          {stats.reduce((a, s) => a + s.failed, 0)} failed
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Space to {paused ? "resume" : "pause"}, Escape or q to go back
        </Text>
      </Box>
    </Box>
  );
};
