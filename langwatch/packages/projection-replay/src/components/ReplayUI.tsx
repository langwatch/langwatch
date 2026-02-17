import React, { useState, useEffect, useRef } from "react";
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
  type BatchPhase,
} from "../replay";
import { hasPreviousRun, getCompletedSet, cleanupAll } from "../markers";
import { ReplayLog } from "../replayLog";
import { ProgressBar } from "./ProgressBar";

// ─── Spinner ─────────────────────────────────────────────────────────────────

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

// ─── Phase Step Indicators ───────────────────────────────────────────────────

const PHASES: BatchPhase[] = ["mark", "drain", "cutoff", "load", "replay", "unmark"];

function phaseIndex(p: BatchPhase): number {
  return PHASES.indexOf(p);
}

function PhaseIndicator({ label, current }: { label: BatchPhase; current: BatchPhase }) {
  const idx = phaseIndex(label);
  const curIdx = phaseIndex(current);

  if (idx < curIdx) {
    return <Text><Text color="green">{"✓"}</Text>{` ${label} `}</Text>;
  }
  if (idx === curIdx) {
    return <Text><Spinner />{` ${label} `}</Text>;
  }
  return <Text dimColor>{`· ${label} `}</Text>;
}

// ─── Replay Rate Hook ────────────────────────────────────────────────────────

function useReplayRate(eventsReplayed: number, batchPhase: BatchPhase): number {
  const startRef = useRef<number | null>(null);

  if (batchPhase === "replay" && startRef.current === null && eventsReplayed === 0) {
    startRef.current = Date.now();
  }
  if (batchPhase !== "replay") {
    startRef.current = null;
  }

  if (startRef.current == null || eventsReplayed === 0) return 0;
  const elapsed = (Date.now() - startRef.current) / 1000;
  return elapsed > 0 ? eventsReplayed / elapsed : 0;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface ReplayUIProps {
  projection: DiscoveredFoldProjection;
  since: string;
  tenantId: string;
  projectInfo?: { name: string; slug: string } | null;
  batchSize: number;
  aggregateBatchSize: number;
  concurrency: number;
  dryRun: boolean;
  client: ClickHouseClient;
  redis: IORedis;
}

type Phase =
  | "discovering"
  | "confirm"
  | "resume-prompt"
  | "replaying"
  | "done"
  | "error"
  | "cancelled";

// ─── Main Component ──────────────────────────────────────────────────────────

export function ReplayUI({
  projection,
  since,
  tenantId,
  projectInfo,
  batchSize,
  aggregateBatchSize,
  concurrency,
  dryRun,
  client,
  redis,
}: ReplayUIProps) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("discovering");
  const [aggregates, setAggregates] = useState<DiscoveredAggregate[]>([]);
  const [byTenant, setByTenant] = useState<Map<string, DiscoveredAggregate[]>>(
    new Map(),
  );
  const [tenantCount, setTenantCount] = useState(0);
  const [totalEvents, setTotalEvents] = useState(0);
  const [progress, setProgress] = useState<ReplayProgress | null>(null);
  const [result, setResult] = useState<{
    aggregatesReplayed: number;
    totalEvents: number;
    durationSec: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [previousRun, setPreviousRun] = useState<{
    completedCount: number;
    markerCount: number;
  } | null>(null);
  const [logFile, setLogFile] = useState("");

  const replayRate = useReplayRate(
    progress?.eventsReplayed ?? 0,
    progress?.batchPhase ?? "mark",
  );

  // Exit Ink when we reach a terminal phase
  useEffect(() => {
    if (phase === "done" || phase === "error") {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  // Discovery phase
  useEffect(() => {
    void (async () => {
      try {
        const disc = await discoverAggregates({
          client,
          projection,
          since,
          tenantId,
        });
        setAggregates(disc.aggregates);
        setByTenant(disc.byTenant);
        setTenantCount(disc.tenantCount);
        setTotalEvents(disc.totalEvents);

        const prev = await hasPreviousRun({
          redis,
          projectionName: projection.projectionName,
        });

        if (prev.completedCount > 0 || prev.markerCount > 0) {
          setPreviousRun(prev);
          setPhase("resume-prompt");
        } else if (dryRun) {
          setPhase("done");
        } else {
          setPhase("confirm");
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
  }, []);

  const startReplay = async (completedSet: Set<string>) => {
    setPhase("replaying");
    const log = new ReplayLog(projection.projectionName);
    setLogFile(log.filePath);
    log.write({
      step: "start",
      projection: projection.projectionName,
      since,
      args: { batchSize, aggregateBatchSize, dryRun },
    });
    log.write({
      step: "discover",
      aggregateCount: aggregates.length,
      tenantCount,
    });

    const startTime = Date.now();
    try {
      const res = await runReplay({
        client,
        redis,
        projection,
        aggregates,
        byTenant,
        batchSize,
        aggregateBatchSize,
        log,
        onProgress: setProgress,
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
      setResult({ ...res, durationSec });
      setPhase("done");
    } catch (err) {
      log.close();
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  // ─── Menu handlers ───────────────────────────────────────────────────────

  const confirmItems = [
    { label: "Start replay", value: "start" as const },
    { label: "Cancel", value: "cancel" as const },
  ];

  const resumeItems = [
    {
      label: `Resume (skip ${previousRun?.completedCount ?? 0} completed)`,
      value: "resume" as const,
    },
    {
      label: `Start fresh (replay all ${aggregates.length})`,
      value: "fresh" as const,
    },
    { label: "Cleanup markers and exit", value: "cleanup" as const },
    { label: "Cancel", value: "cancel" as const },
  ];

  const handleConfirm = (item: { value: string }) => {
    if (item.value === "start") {
      void startReplay(new Set());
    } else {
      void (async () => {
        await cleanupAll({ redis, projectionName: projection.projectionName });
        setPhase("cancelled");
        setTimeout(() => exit(), 100);
      })();
    }
  };

  const handleResume = (item: { value: string }) => {
    if (item.value === "resume") {
      void (async () => {
        const completed = await getCompletedSet({
          redis,
          projectionName: projection.projectionName,
        });
        void startReplay(completed);
      })();
    } else if (item.value === "fresh") {
      void (async () => {
        await cleanupAll({
          redis,
          projectionName: projection.projectionName,
        });
        void startReplay(new Set());
      })();
    } else {
      void (async () => {
        await cleanupAll({ redis, projectionName: projection.projectionName });
        setPhase("cancelled");
        setTimeout(() => exit(), 100);
      })();
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Text bold>Projection Replay</Text>
      <Text>{"━".repeat(50)}</Text>

      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Text>
          <Text bold>{projection.projectionName}</Text>
          <Text dimColor>{` (${projection.pipelineName})`}</Text>
        </Text>
        <Text>
          <Text dimColor>project </Text>
          {projectInfo ? `${projectInfo.name} (${tenantId})` : tenantId}
        </Text>
        <Text>
          <Text dimColor>since   </Text>
          {since}
        </Text>

        {phase === "discovering" && (
          <Box marginTop={1}>
            <Spinner />
            <Text> Discovering affected aggregates...</Text>
          </Box>
        )}

        {(phase === "confirm" ||
          phase === "resume-prompt" ||
          phase === "replaying" ||
          phase === "done") &&
          aggregates.length > 0 && (
            <Text>
              <Text dimColor>found   </Text>
              {aggregates.length.toLocaleString()} aggregates{" "}
              <Text dimColor>{"·"}</Text> {totalEvents.toLocaleString()} events
            </Text>
          )}

        {logFile && (
          <Text>
            <Text dimColor>log     </Text>
            {logFile}
          </Text>
        )}
      </Box>

      {/* Confirm */}
      {phase === "confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <SelectInput items={confirmItems} onSelect={handleConfirm} />
        </Box>
      )}

      {/* Resume prompt */}
      {phase === "resume-prompt" && (
        <Box flexDirection="column" marginTop={1}>
          <Box marginLeft={2}>
            <Text color="yellow">
              Previous run: {previousRun?.completedCount ?? 0}/
              {aggregates.length} completed
              {(previousRun?.markerCount ?? 0) > 0 &&
                `, ${previousRun?.markerCount} stale`}
            </Text>
          </Box>
          <SelectInput items={resumeItems} onSelect={handleResume} />
        </Box>
      )}

      {/* Replaying */}
      {phase === "replaying" && progress && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {/* Batch header */}
          <Text bold>
            Batch {progress.currentBatch}/{progress.totalBatches}
            <Text dimColor>
              {" "}{"·"} {progress.batchAggregates} aggregates
            </Text>
          </Text>

          {/* Phase steps */}
          <Box marginLeft={2} marginTop={0}>
            {PHASES.map((p) => (
              <PhaseIndicator key={p} label={p} current={progress.batchPhase} />
            ))}
          </Box>

          {/* Replay progress bar (the slow part) */}
          {progress.batchPhase === "replay" && progress.totalBatchEvents > 0 && (
            <Box marginLeft={2} flexDirection="column">
              <ProgressBar
                current={progress.eventsReplayed}
                total={progress.totalBatchEvents}
                unit="events"
                rate={replayRate}
              />
            </Box>
          )}

          {/* Overall */}
          <Box marginTop={1} flexDirection="column">
            <ProgressBar
              current={progress.aggregatesCompleted}
              total={progress.totalAggregates}
              unit="aggregates"
            />
            <Text dimColor>
              {progress.totalEventsReplayed.toLocaleString()} events{" "}
              {"·"} {Math.round(progress.elapsedSec)}s elapsed
              {progress.skippedCount > 0 &&
                ` · ${progress.skippedCount} skipped`}
            </Text>
          </Box>
        </Box>
      )}

      {/* Done - dry run */}
      {phase === "done" && dryRun && (
        <Box marginTop={1} marginLeft={2}>
          <Text color="green">
            Dry run complete. {aggregates.length.toLocaleString()} aggregates
            across {tenantCount} tenant(s) would be replayed.
          </Text>
        </Box>
      )}

      {/* Done - replay */}
      {phase === "done" && !dryRun && result && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text color="green">
            Done. {result.aggregatesReplayed.toLocaleString()} aggregates,{" "}
            {result.totalEvents.toLocaleString()} events in {result.durationSec}s.
          </Text>
          <Text dimColor>
            Markers removed — live processing continues from cutoff.
          </Text>
        </Box>
      )}

      {/* Error */}
      {phase === "error" && (
        <Box marginTop={1} marginLeft={2}>
          <Text color="red">Error: {errorMsg}</Text>
        </Box>
      )}

      {/* Cancelled */}
      {phase === "cancelled" && (
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>Cancelled.</Text>
        </Box>
      )}
    </Box>
  );
}
