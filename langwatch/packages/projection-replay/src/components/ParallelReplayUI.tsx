import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useApp } from "ink";
import SelectInput from "ink-select-input";
import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type { DiscoveredFoldProjection } from "../discovery";
import type { DiscoveredAggregate } from "../clickhouse";
import {
  discoverAggregates,
  runReplay,
  type ReplayProgress,
} from "../replay";
import { hasPreviousRun, getCompletedSet, cleanupAll } from "../markers";
import { ReplayLog } from "../replayLog";
import { ProgressBar } from "./ProgressBar";

// ─── Spinner ────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      80,
    );
    return () => clearInterval(timer);
  }, []);
  return <Text color="yellow">{SPINNER_FRAMES[frame]}</Text>;
}

// ─── Types ──────────────────────────────────────────────────────────────────

type ProjectionPhase =
  | "discovering"
  | "has-previous"
  | "waiting"
  | "replaying"
  | "done"
  | "error";

interface ProjectionState {
  projection: DiscoveredFoldProjection;
  phase: ProjectionPhase;
  aggregateCount: number;
  totalEvents: number;
  progress: ReplayProgress | null;
  result: { aggregatesReplayed: number; totalEvents: number; durationSec: number } | null;
  errorMsg: string;
  previousRun: { completedCount: number; markerCount: number } | null;
  logFile: string;
}

interface ParallelReplayUIProps {
  projections: DiscoveredFoldProjection[];
  tenantId: string;
  projectInfo?: { name: string; slug: string } | null;
  since: string;
  batchSize: number;
  aggregateBatchSize: number;
  concurrency: number;
  dryRun: boolean;
  client: ClickHouseClient;
  redis: IORedis;
}

type GlobalPhase = "discovering" | "confirm" | "replaying" | "done" | "error" | "cancelled";

// ─── Main Component ─────────────────────────────────────────────────────────

export function ParallelReplayUI({
  projections,
  tenantId,
  projectInfo,
  since,
  batchSize,
  aggregateBatchSize,
  concurrency,
  dryRun,
  client,
  redis,
}: ParallelReplayUIProps) {
  const { exit } = useApp();
  const [globalPhase, setGlobalPhase] = useState<GlobalPhase>("discovering");
  const [states, setStates] = useState<ProjectionState[]>(() =>
    projections.map((projection) => ({
      projection,
      phase: "discovering",
      aggregateCount: 0,
      totalEvents: 0,
      progress: null,
      result: null,
      errorMsg: "",
      previousRun: null,
      logFile: "",
    })),
  );

  const updateState = useCallback(
    (index: number, update: Partial<ProjectionState>) => {
      setStates((prev) => {
        const next = [...prev];
        next[index] = { ...next[index]!, ...update };
        return next;
      });
    },
    [],
  );

  // Exit Ink when terminal phase
  useEffect(() => {
    if (globalPhase === "done" || globalPhase === "error" || globalPhase === "cancelled") {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [globalPhase]);

  // Discovery phase — discover all projections in parallel
  useEffect(() => {
    void (async () => {
      try {
        const discoveries = await Promise.all(
          projections.map(async (projection, i) => {
            const disc = await discoverAggregates({ client, projection, since, tenantId });
            const prev = await hasPreviousRun({
              redis,
              projectionName: projection.projectionName,
            });

            updateState(i, {
              aggregateCount: disc.aggregates.length,
              totalEvents: disc.totalEvents,
              phase: prev.completedCount > 0 || prev.markerCount > 0 ? "has-previous" : "waiting",
              previousRun: prev.completedCount > 0 || prev.markerCount > 0 ? prev : null,
            });

            return { disc, prev };
          }),
        );

        const hasPrev = discoveries.some(
          (d) => d.prev.completedCount > 0 || d.prev.markerCount > 0,
        );

        if (dryRun) {
          setStates((prev) => prev.map((s) => ({ ...s, phase: "done" as const })));
          setGlobalPhase("done");
        } else {
          setGlobalPhase("confirm");
        }
      } catch (err) {
        setGlobalPhase("error");
      }
    })();
  }, []);

  // Start all replays in parallel
  const startAllReplays = async (mode: "fresh" | "resume") => {
    setGlobalPhase("replaying");

    const replayPromises = projections.map(async (projection, i) => {
      const state = states[i]!;
      const log = new ReplayLog(projection.projectionName);
      updateState(i, { phase: "replaying", logFile: log.filePath });

      log.write({
        step: "start",
        projection: projection.projectionName,
        since,
        args: { batchSize, aggregateBatchSize, dryRun },
      });

      // Re-discover (states may be stale by now due to closures)
      const disc = await discoverAggregates({ client, projection, since, tenantId });
      log.write({ step: "discover", aggregateCount: disc.aggregates.length, tenantCount: disc.tenantCount });

      let completedSet = new Set<string>();
      if (mode === "resume" && state.previousRun) {
        completedSet = await getCompletedSet({
          redis,
          projectionName: projection.projectionName,
        });
      } else {
        await cleanupAll({ redis, projectionName: projection.projectionName });
      }

      const startTime = Date.now();
      try {
        const res = await runReplay({
          client,
          redis,
          projection,
          aggregates: disc.aggregates,
          byTenant: disc.byTenant,
          batchSize,
          aggregateBatchSize,
          log,
          onProgress: (progress) => updateState(i, { progress }),
          completedSet,
        });

        const durationSec = Math.round((Date.now() - startTime) / 1000);
        log.write({
          step: "complete",
          aggregatesReplayed: res.aggregatesReplayed,
          totalEvents: res.totalEvents,
          durationSec,
        });
        log.close();
        updateState(i, { phase: "done", result: { ...res, durationSec } });
      } catch (err) {
        log.close();
        updateState(i, {
          phase: "error",
          errorMsg: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await Promise.all(replayPromises);
    setGlobalPhase("done");
  };

  // ─── Confirm handlers ──────────────────────────────────────────────────

  const hasPreviousRuns = states.some((s) => s.previousRun !== null);

  const confirmItems = hasPreviousRuns
    ? [
        { label: "Resume all (skip completed)", value: "resume" as const },
        { label: "Start fresh (replay all)", value: "fresh" as const },
        { label: "Cleanup markers and exit", value: "cleanup" as const },
        { label: "Cancel", value: "cancel" as const },
      ]
    : [
        { label: "Start replay", value: "fresh" as const },
        { label: "Cancel", value: "cancel" as const },
      ];

  const handleConfirm = (item: { value: string }) => {
    if (item.value === "resume") {
      void startAllReplays("resume");
    } else if (item.value === "fresh") {
      void startAllReplays("fresh");
    } else if (item.value === "cleanup") {
      void (async () => {
        for (const p of projections) {
          await cleanupAll({ redis, projectionName: p.projectionName });
        }
        setGlobalPhase("cancelled");
      })();
    } else {
      setGlobalPhase("cancelled");
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  const totalAggregates = states.reduce((sum, s) => sum + s.aggregateCount, 0);
  const totalEvents = states.reduce((sum, s) => sum + s.totalEvents, 0);

  return (
    <Box flexDirection="column">
      <Text bold>Projection Replay</Text>
      <Text>{"━".repeat(50)}</Text>

      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Text>
          <Text dimColor>project </Text>
          {projectInfo ? `${projectInfo.name} (${tenantId})` : tenantId}
        </Text>
        <Text>
          <Text dimColor>since   </Text>
          {since}
        </Text>
        <Text>
          <Text dimColor>targets </Text>
          {projections.map((p) => p.projectionName).join(", ")}
        </Text>

        {globalPhase === "discovering" && (
          <Box marginTop={1}>
            <Spinner />
            <Text> Discovering affected aggregates...</Text>
          </Box>
        )}

        {globalPhase !== "discovering" && totalAggregates > 0 && (
          <Text>
            <Text dimColor>found   </Text>
            {totalAggregates.toLocaleString()} aggregates{" "}
            <Text dimColor>·</Text> {totalEvents.toLocaleString()} events
          </Text>
        )}
      </Box>

      {/* Confirm */}
      {globalPhase === "confirm" && (
        <Box flexDirection="column" marginTop={1}>
          {hasPreviousRuns && (
            <Box marginLeft={2}>
              <Text color="yellow">
                Previous runs detected for some projections
              </Text>
            </Box>
          )}
          <SelectInput items={confirmItems} onSelect={handleConfirm} />
        </Box>
      )}

      {/* Per-projection progress */}
      {globalPhase === "replaying" && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {states.map((s) => (
            <ProjectionProgress key={s.projection.projectionName} state={s} />
          ))}
        </Box>
      )}

      {/* Done - dry run */}
      {globalPhase === "done" && dryRun && (
        <Box marginTop={1} marginLeft={2}>
          <Text color="green">
            Dry run complete. {totalAggregates.toLocaleString()} aggregates
            would be replayed across {projections.length} projection(s).
          </Text>
        </Box>
      )}

      {/* Done - replay */}
      {globalPhase === "done" && !dryRun && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {states.map((s) => (
            <Box key={s.projection.projectionName}>
              {s.phase === "done" && s.result && (
                <Text color="green">
                  {"✓ "}
                  <Text bold>{s.projection.projectionName}</Text>
                  {" — "}
                  {s.result.aggregatesReplayed.toLocaleString()} aggregates,{" "}
                  {s.result.totalEvents.toLocaleString()} events in {s.result.durationSec}s
                </Text>
              )}
              {s.phase === "error" && (
                <Text color="red">
                  {"✗ "}
                  <Text bold>{s.projection.projectionName}</Text>
                  {" — "}{s.errorMsg}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Cancelled */}
      {globalPhase === "cancelled" && (
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>Cancelled.</Text>
        </Box>
      )}
    </Box>
  );
}

// ─── Per-Projection Progress Line ───────────────────────────────────────────

function ProjectionProgress({ state }: { state: ProjectionState }) {
  const { projection, phase, progress } = state;

  if (phase === "done" && state.result) {
    return (
      <Text color="green">
        {"✓ "}
        <Text bold>{projection.projectionName}</Text>
        {" — "}
        {state.result.aggregatesReplayed.toLocaleString()} aggregates,{" "}
        {state.result.totalEvents.toLocaleString()} events in {state.result.durationSec}s
      </Text>
    );
  }

  if (phase === "error") {
    return (
      <Text color="red">
        {"✗ "}
        <Text bold>{projection.projectionName}</Text>
        {" — "}{state.errorMsg}
      </Text>
    );
  }

  if (phase === "replaying" && progress) {
    const pct = progress.totalAggregates > 0
      ? Math.round((progress.aggregatesCompleted / progress.totalAggregates) * 100)
      : 0;

    const eventsDetail =
      progress.batchPhase === "replay" && progress.totalBatchEvents > 0
        ? ` ${progress.eventsReplayed.toLocaleString()}/${progress.totalBatchEvents.toLocaleString()} events ·`
        : "";

    return (
      <Text>
        <Spinner />{" "}
        <Text bold>{projection.projectionName}</Text>
        <Text dimColor>
          {" "}batch {progress.currentBatch}/{progress.totalBatches}
          {" · "}{progress.batchPhase}
          {" ·"}{eventsDetail}
          {" "}{progress.aggregatesCompleted}/{progress.totalAggregates} agg
          {" · "}{progress.totalEventsReplayed.toLocaleString()} events
          {" · "}{pct}%
        </Text>
      </Text>
    );
  }

  return (
    <Text>
      <Spinner />{" "}
      <Text bold>{projection.projectionName}</Text>
      <Text dimColor> discovering...</Text>
    </Text>
  );
}
