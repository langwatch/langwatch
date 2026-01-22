import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import type { CliOptions } from "../cli";
import type { DiscoveredEventHandler } from "../discovery/eventHandlers.types";
import type { AggregateLinkInfo } from "../discovery/links";
import { getLinksForAggregate } from "../discovery/links";
import type { DiscoveredProjection } from "../discovery/projections.types";
import { loadEventLog } from "../io/loadEvents";
import {
  loadEventsFromClickhouse,
  queryChildAggregates,
} from "../io/loadFromClickhouse";
import type { Event } from "../lib/types";
import App from "./App";
import { FullscreenLayout } from "./FullscreenLayout";
import { SetupScreen } from "./SetupScreen";

/** Resolved child aggregate info with actual IDs from the database */
export interface ResolvedChildAggregate {
  aggregateType: string;
  aggregateIds: string[];
}

type LoadMode = "file" | "database";

interface RootProps {
  options: CliOptions;
  projections: DiscoveredProjection[];
  eventHandlers: DiscoveredEventHandler[];
  pipelineAggregateTypes: Record<string, string>;
}

type RootState =
  | { phase: "setup"; mode: LoadMode }
  | { phase: "loading"; mode: LoadMode; aggregateId?: string }
  | {
      phase: "ready";
      events: Event[];
      mode: LoadMode;
      linkInfo?: AggregateLinkInfo;
      resolvedChildren?: ResolvedChildAggregate[];
    }
  | { phase: "error"; message: string };

/**
 * Determines the initial state based on CLI options.
 */
function getInitialState(options: CliOptions): RootState {
  const mode: LoadMode = options.file ? "file" : "database";

  if (mode === "file") {
    // File mode: go straight to loading
    return { phase: "loading", mode: "file" };
  } else if (options.aggregate) {
    // Database mode with aggregate already specified: go to loading
    return {
      phase: "loading",
      mode: "database",
      aggregateId: options.aggregate,
    };
  } else {
    // Database mode: need to collect aggregate ID via setup screen
    return { phase: "setup", mode: "database" };
  }
}

/**
 * Root component that orchestrates the app flow:
 * Setup (if needed) → Loading → App
 *
 * @example
 * <Root options={cliOptions} projections={projections} />
 */
export const Root: React.FC<RootProps> = ({
  options,
  projections,
  eventHandlers,
  pipelineAggregateTypes,
}) => {
  const mode: LoadMode = options.file ? "file" : "database";
  const [state, setState] = useState<RootState>(() => getInitialState(options));
  const [env, setEnv] = useState(options.env);
  const [aggregateId, setAggregateId] = useState(options.aggregate ?? "");
  const [profile] = useState(options.profile);

  // Handle setup completion
  const handleSetupComplete = (
    selectedAggregateId: string,
    selectedEnv?: string,
  ) => {
    setAggregateId(selectedAggregateId);
    if (selectedEnv) {
      setEnv(selectedEnv as typeof env);
    }
    setState({
      phase: "loading",
      mode: "database",
      aggregateId: selectedAggregateId,
    });
  };

  // Handle navigation to related aggregate
  const handleNavigateToAggregate = (
    targetAggregateId: string,
    _aggregateType: string,
  ) => {
    setAggregateId(targetAggregateId);
    setState({
      phase: "loading",
      mode: "database",
      aggregateId: targetAggregateId,
    });
  };

  // Load events when entering loading phase
  useEffect(() => {
    if (state.phase !== "loading") return;

    const loadEvents = async () => {
      try {
        let events: Event[];

        if (mode === "file" && options.file) {
          events = await loadEventLog(options.file);
        } else if (mode === "database") {
          const targetAggregateId = state.aggregateId ?? aggregateId;
          if (!targetAggregateId) {
            setState({ phase: "error", message: "No aggregate ID specified" });
            return;
          }
          events = await loadEventsFromClickhouse({
            aggregateId: targetAggregateId,
            env,
            profile,
          });
        } else {
          setState({ phase: "error", message: "Invalid configuration" });
          return;
        }

        // Discover links for the aggregate type
        const aggregateType = events[0]?.aggregateType;
        const targetAggregateId = state.aggregateId ?? aggregateId;
        let linkInfo: AggregateLinkInfo | undefined;
        let resolvedChildren: ResolvedChildAggregate[] = [];

        if (aggregateType) {
          try {
            linkInfo = await getLinksForAggregate(aggregateType as any);
          } catch {
            // Links are optional, continue without them
          }

          // Query for child aggregates (only in database mode)
          if (linkInfo && mode === "database" && targetAggregateId) {
            const childQueries = linkInfo.childLinks.map(async (childLink) => {
              try {
                const childIds = await queryChildAggregates({
                  parentId: targetAggregateId,
                  childAggregateType: childLink.toAggregateType,
                  env,
                  profile,
                });
                return {
                  aggregateType: childLink.toAggregateType,
                  aggregateIds: childIds,
                };
              } catch {
                return {
                  aggregateType: childLink.toAggregateType,
                  aggregateIds: [],
                };
              }
            });
            resolvedChildren = await Promise.all(childQueries);

            // Load events from all child aggregates and merge into timeline
            const childEventPromises = resolvedChildren.flatMap((child) =>
              child.aggregateIds.map((id) =>
                loadEventsFromClickhouse({
                  aggregateId: id,
                  env,
                  profile,
                }).catch(() => [] as Event[]),
              ),
            );
            const childEventArrays = await Promise.all(childEventPromises);
            const allEvents = [...events, ...childEventArrays.flat()].sort(
              (a, b) => a.timestamp - b.timestamp,
            );
            events = allEvents;
          }
        }

        setState({ phase: "ready", events, mode, linkInfo, resolvedChildren });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        setState({ phase: "error", message });
      }
    };

    void loadEvents();
  }, [state.phase, mode, options.file, aggregateId, env, profile]);

  // Render based on current phase
  switch (state.phase) {
    case "setup":
      return (
        <SetupScreen
          env={env}
          profile={profile}
          onComplete={handleSetupComplete}
        />
      );

    case "loading":
      return (
        <FullscreenLayout>
          <Box
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            flexGrow={1}
          >
            <Text color="cyan">Loading events...</Text>
            {mode === "database" && (
              <Text dimColor>
                Connecting to ClickHouse ({env}) via AWS profile {profile}
              </Text>
            )}
            {mode === "file" && options.file && (
              <Text dimColor>Reading from {options.file}</Text>
            )}
          </Box>
        </FullscreenLayout>
      );

    case "error":
      return (
        <FullscreenLayout>
          <Box
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            flexGrow={1}
          >
            <Text color="red" bold>
              Error
            </Text>
            <Text color="red">{state.message}</Text>
            <Box marginTop={2}>
              <Text dimColor>Press Ctrl+C to exit</Text>
            </Box>
          </Box>
        </FullscreenLayout>
      );

    case "ready":
      return (
        <App
          events={state.events}
          projections={projections}
          eventHandlers={eventHandlers}
          pipelineAggregateTypes={pipelineAggregateTypes}
          mode={state.mode}
          env={mode === "database" ? env : undefined}
          linkInfo={state.linkInfo}
          resolvedChildren={state.resolvedChildren}
          onNavigateToAggregate={
            mode === "database" ? handleNavigateToAggregate : undefined
          }
        />
      );
  }
};
