import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import React, { useEffect, useState } from "react";
import { listRecentAggregates } from "../io/loadFromClickhouse";
import type { Environment } from "../io/secrets";
import { FullscreenLayout } from "./FullscreenLayout";

interface SetupScreenProps {
  env: Environment;
  profile: string;
  onComplete: (aggregateId: string, env?: string) => void;
}

type SetupPhase = "aggregate-input" | "aggregate-list" | "loading-list";

interface AggregateItem {
  aggregateId: string;
  aggregateType: string;
  eventCount: number;
}

/**
 * Combined welcome and setup screen for database mode.
 * Shows branding and prompts for aggregate ID.
 *
 * @example
 * <SetupScreen env="dev" profile="lw-dev" onComplete={handleComplete} />
 */
export const SetupScreen: React.FC<SetupScreenProps> = ({
  env: initialEnv,
  profile,
  onComplete,
}) => {
  const [phase, setPhase] = useState<SetupPhase>("aggregate-input");
  const [env] = useState<Environment>(initialEnv);
  const [aggregateId, setAggregateId] = useState("");
  const [recentAggregates, setRecentAggregates] = useState<AggregateItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load recent aggregates when switching to list mode
  useEffect(() => {
    if (phase !== "loading-list") return;

    const loadAggregates = async () => {
      try {
        const aggregates = await listRecentAggregates({
          env,
          profile,
          limit: 20,
        });
        setRecentAggregates(aggregates);
        setPhase("aggregate-list");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load aggregates",
        );
        setPhase("aggregate-input");
      }
    };

    void loadAggregates();
  }, [phase, env, profile]);

  useInput((input, key) => {
    // Tab to switch between input and list modes
    if (key.tab && phase === "aggregate-input") {
      setPhase("loading-list");
    } else if (key.tab && phase === "aggregate-list") {
      setPhase("aggregate-input");
    }

    // Enter to submit in input mode
    if (key.return && phase === "aggregate-input" && aggregateId.trim()) {
      onComplete(aggregateId.trim(), env);
    }
  });

  const handleAggregateSelect = (item: { value: string }) => {
    onComplete(item.value, env);
  };

  return (
    <FullscreenLayout>
      <Box
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        flexGrow={1}
      >
        {/* Banner */}
        <Box
          flexDirection="column"
          alignItems="center"
          borderStyle="double"
          borderColor="cyan"
          paddingX={3}
          paddingY={1}
        >
          <Text bold color="yellow">
            DEJA VIEW
          </Text>
          <Text dimColor>Event Sourcing Time Travel</Text>
        </Box>

        {/* Mode info */}
        <Box marginTop={1}>
          <Text dimColor>Database Mode</Text>
          <Text> • </Text>
          <Text color="green">{env}</Text>
          <Text dimColor> • </Text>
          <Text dimColor>profile: </Text>
          <Text>{profile}</Text>
        </Box>

        {/* Error display */}
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        {/* Main content */}
        <Box marginTop={2} flexDirection="column" width={60}>
          {/* Aggregate ID input phase */}
          {phase === "aggregate-input" && (
            <Box flexDirection="column">
              <Text bold>Enter Aggregate ID:</Text>
              <Box marginTop={1}>
                <Text color="cyan">{">"} </Text>
                <TextInput
                  value={aggregateId}
                  onChange={setAggregateId}
                  placeholder="e.g., trace_abc123 or span:xyz789"
                />
              </Box>
              <Box marginTop={2}>
                <Text dimColor>Enter to load • Tab to browse recent</Text>
              </Box>
            </Box>
          )}

          {/* Loading aggregates phase */}
          {phase === "loading-list" && (
            <Box flexDirection="column" alignItems="center">
              <Text color="yellow">Loading recent aggregates...</Text>
            </Box>
          )}

          {/* Aggregate list selection phase */}
          {phase === "aggregate-list" && (
            <Box flexDirection="column">
              <Text bold>Recent aggregates:</Text>
              <Box marginTop={1}>
                {recentAggregates.length > 0 ? (
                  <SelectInput
                    items={recentAggregates.map((agg) => ({
                      label: `[${agg.aggregateType}] ${agg.aggregateId} (${agg.eventCount} events)`,
                      value: agg.aggregateId,
                    }))}
                    onSelect={handleAggregateSelect}
                    limit={12}
                  />
                ) : (
                  <Text dimColor>No aggregates found</Text>
                )}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Tab to enter ID manually</Text>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </FullscreenLayout>
  );
};
