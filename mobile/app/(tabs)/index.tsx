import { Text, View } from "react-native";

import { trpc } from "@/api/trpc";
import {
  formatBytes,
  formatCount,
  formatMilliseconds,
  formatPercent,
  formatRate,
} from "@/lib/format";
import { redisMemorySeverity } from "@/lib/ops";
import {
  DetailRow,
  EmptyRow,
  ExpandableRow,
  QueryState,
  Row,
  Screen,
  Section,
  StatTile,
  TileGrid,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/**
 * The stats screen.
 *
 * Ordered by what an operator opening their phone at 2am needs first: what is
 * wrong, then how fast work is moving, then how much room the machine has left.
 * Throughput before Redis, because a queue that has stopped moving is a page and
 * a Redis at 60% is not.
 */
export default function OverviewScreen() {
  const theme = useTheme();

  // Matches the server's own collection cadence. `react-query` stops the
  // interval when the app is backgrounded, so a phone in a pocket does not keep
  // polling the very thing it is monitoring.
  const dashboard = trpc.ops.getDashboardSnapshot.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  return (
    <Screen
      onRefresh={() => void dashboard.refetch()}
      refreshing={dashboard.isRefetching}
    >
      <QueryState query={dashboard}>
        {(snapshot) => {
          if (!snapshot) {
            return (
              <Section title="Right now">
                <EmptyRow message="The ops metrics collector is not running on this instance." />
              </Section>
            );
          }

          // The collector appends one throughput point per collect cycle, so an
          // empty history IS "no cycle has completed" — the figures below read
          // as a quiet platform when really nothing has measured it yet.
          const collected = snapshot.throughputHistory.length > 0;

          return (
            <>
              {collected ? null : (
                <Section>
                  <Row last>
                    <Text style={{ color: theme.warning, fontSize: 13 }}>
                      Waiting for the first collection cycle — these figures are
                      not live yet.
                    </Text>
                  </Row>
                </Section>
              )}

              <View>
                <TileGrid>
                  <StatTile
                    title="Blocked groups"
                    value={formatCount(snapshot.blockedGroups)}
                    caption={`of ${formatCount(snapshot.totalGroups)} groups`}
                    severity={snapshot.blockedGroups > 0 ? "critical" : "normal"}
                  />
                  <StatTile
                    title="Pending jobs"
                    value={formatCount(snapshot.totalPendingJobs)}
                    caption={
                      snapshot.pendingDrift === 0
                        ? "counter matches"
                        : `counter off by ${formatCount(snapshot.pendingDrift)}`
                    }
                    severity={snapshot.pendingDrift !== 0 ? "warning" : "normal"}
                  />
                  <StatTile
                    title="Parked groups"
                    value={formatCount(snapshot.parkedGroups)}
                    caption="held by a tenant cap"
                    severity={snapshot.parkedGroups > 0 ? "warning" : "normal"}
                  />
                  <StatTile
                    title="Failing"
                    value={`${formatRate(snapshot.failedPerSec)}/s`}
                    caption={`peak ${formatRate(snapshot.peakFailedPerSec)}/s`}
                    severity={snapshot.failedPerSec > 0 ? "critical" : "normal"}
                  />
                </TileGrid>
              </View>

              <View>
                <TileGrid>
                  <StatTile
                    title="Ingested"
                    value={`${formatRate(snapshot.throughputIngestedPerSec)}/s`}
                    caption={`peak ${formatRate(snapshot.peakIngestedPerSec)}/s`}
                  />
                  <StatTile
                    title="Completed"
                    value={`${formatRate(snapshot.completedPerSec)}/s`}
                    caption={`peak ${formatRate(snapshot.peakCompletedPerSec)}/s`}
                  />
                  <StatTile
                    title="Latency p50"
                    value={formatMilliseconds(snapshot.latencyP50Ms)}
                    caption={`peak ${formatMilliseconds(snapshot.peakLatencyP50Ms)}`}
                  />
                  <StatTile
                    title="Latency p99"
                    value={formatMilliseconds(snapshot.latencyP99Ms)}
                    caption={`peak ${formatMilliseconds(snapshot.peakLatencyP99Ms)}`}
                  />
                </TileGrid>
              </View>

              <Section title="Phases">
                <PhaseRow name="Commands" metrics={snapshot.phases.commands} />
                <PhaseRow
                  name="Projections"
                  metrics={snapshot.phases.projections}
                />
                <PhaseRow name="Reactions" metrics={snapshot.phases.reactions} last />
              </Section>

              <View>
                <TileGrid>
                  <StatTile
                    title="Redis memory"
                    value={formatBytes(snapshot.redisMemoryUsedBytes)}
                    caption={
                      snapshot.redisMemoryMaxBytes > 0
                        ? `${formatPercent(
                            (snapshot.redisMemoryUsedBytes /
                              snapshot.redisMemoryMaxBytes) *
                              100,
                          )} of ${formatBytes(snapshot.redisMemoryMaxBytes)}`
                        : "no limit set"
                    }
                    severity={redisMemorySeverity(snapshot)}
                  />
                  <StatTile
                    title="Engine CPU"
                    value={
                      snapshot.redisEngineCpuPercent === null
                        ? "—"
                        : formatPercent(snapshot.redisEngineCpuPercent)
                    }
                    caption={
                      snapshot.redisEngineCpuPercent === null
                        ? "needs two samples"
                        : undefined
                    }
                    severity={
                      (snapshot.redisEngineCpuPercent ?? 0) > 80
                        ? "critical"
                        : "normal"
                    }
                  />
                  <StatTile
                    title="Redis clients"
                    value={formatCount(snapshot.redisConnectedClients)}
                  />
                  <StatTile
                    title="Process memory"
                    value={`${snapshot.processMemoryUsedMb} MB`}
                    caption={`of ${snapshot.processMemoryTotalMb} MB`}
                  />
                </TileGrid>
              </View>

              {snapshot.pausedKeys.length > 0 ? (
                <Section
                  title="Paused pipelines"
                  footer="Paused from the web console. This app shows them but cannot change them."
                >
                  {snapshot.pausedKeys.map((key, index) => (
                    <Row
                      key={key}
                      last={index === snapshot.pausedKeys.length - 1}
                    >
                      <Text
                        style={{
                          color: theme.text,
                          fontFamily: "Menlo",
                          fontSize: 12,
                        }}
                      >
                        {key}
                      </Text>
                    </Row>
                  ))}
                </Section>
              ) : null}

              <Section
                title="Top errors"
                footer={
                  snapshot.topErrors.length > 0
                    ? "One row per distinct error, so one incident reads as one row."
                    : undefined
                }
              >
                {snapshot.topErrors.length === 0 ? (
                  <EmptyRow message="Nothing is failing." />
                ) : (
                  snapshot.topErrors.slice(0, 8).map((cluster, index, list) => (
                    <ExpandableRow
                      key={`${cluster.queueName}/${cluster.normalizedMessage}`}
                      last={index === list.length - 1}
                      summary={
                        <View>
                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <Text
                              numberOfLines={2}
                              style={{ color: theme.text, fontSize: 14, flex: 1 }}
                            >
                              {cluster.sampleMessage}
                            </Text>
                            <Text
                              style={{ color: theme.critical, fontWeight: "700" }}
                            >
                              {formatCount(cluster.count)}
                            </Text>
                          </View>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {[cluster.pipelineName, cluster.queueName]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        </View>
                      }
                      detail={
                        <View style={{ gap: 4 }}>
                          {cluster.sampleGroupIds.map((groupId) => (
                            <Text
                              key={groupId}
                              selectable
                              style={{
                                color: theme.textMuted,
                                fontFamily: "Menlo",
                                fontSize: 11,
                              }}
                            >
                              {groupId}
                            </Text>
                          ))}
                          {cluster.sampleStack ? (
                            <Text
                              selectable
                              style={{
                                color: theme.textMuted,
                                fontFamily: "Menlo",
                                fontSize: 10,
                              }}
                            >
                              {cluster.sampleStack}
                            </Text>
                          ) : null}
                        </View>
                      }
                    />
                  ))
                )}
              </Section>
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}

function PhaseRow({
  name,
  metrics,
  last = false,
}: {
  name: string;
  metrics: {
    pending: number;
    active: number;
    completedPerSec: number;
    failedPerSec: number;
    latencyP99Ms: number;
  };
  last?: boolean;
}) {
  return (
    <DetailRow
      label={name}
      last={last}
      value={
        `${formatCount(metrics.pending)} pending · ${formatCount(metrics.active)} active\n` +
        `${formatRate(metrics.completedPerSec)}/s done · p99 ${formatMilliseconds(
          metrics.latencyP99Ms,
        )}` +
        (metrics.failedPerSec > 0
          ? `\n${formatRate(metrics.failedPerSec)}/s failing`
          : "")
      }
    />
  );
}
