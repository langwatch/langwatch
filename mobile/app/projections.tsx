import { Stack } from "expo-router";
import { Text, View } from "react-native";

import { trpc } from "@/api/trpc";
import { formatCount, formatDateTime } from "@/lib/format";
import {
  DetailRow,
  EmptyRow,
  ExpandableRow,
  Pill,
  QueryState,
  Row,
  Screen,
  Section,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/**
 * Projection replay, viewable and never startable.
 *
 * A replay rebuilds projections across the fleet and takes the single replay lock
 * while it runs. Starting one is a decision made with the event log open in front
 * of you, so this screen shows what is registered, what is running and what has
 * run — and offers no control that begins or cancels anything.
 */
export default function ProjectionsScreen() {
  const theme = useTheme();

  const status = trpc.ops.getReplayStatus.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const history = trpc.ops.getReplayHistory.useQuery();
  const catalog = trpc.ops.listProjections.useQuery();

  const running = status.data?.state === "running" ? status.data : null;

  return (
    <>
      <Stack.Screen options={{ title: "Projection replay" }} />
      <Screen
        onRefresh={() => {
          void status.refetch();
          void history.refetch();
          void catalog.refetch();
        }}
        refreshing={status.isRefetching}
      >
        {running ? (
          <Section title="Running now">
            <DetailRow
              label="Progress"
              value={
                running.aggregatesTotal > 0
                  ? `${formatCount(running.aggregatesProcessed)} of ${formatCount(
                      running.aggregatesTotal,
                    )} aggregates`
                  : // Not "0%": a bar stuck at zero reads as a replay that is
                    // not moving, when really the total is still being counted.
                    `${formatCount(running.aggregatesProcessed)} aggregates so far — total not yet known`
              }
            />
            {running.currentProjection ? (
              <DetailRow
                label="Projection"
                value={running.currentProjection}
                mono
              />
            ) : null}
            {running.currentPhase ? (
              <DetailRow label="Phase" value={running.currentPhase} />
            ) : null}
            <DetailRow
              label="Events"
              value={formatCount(running.eventsProcessed)}
            />
            <DetailRow
              label="Started by"
              value={running.userName ?? "unknown"}
              last
            />
          </Section>
        ) : null}

        <Section
          title="History"
          footer="Starting and cancelling a replay stay in the web console — a replay is chosen with the event log open in front of you."
        >
          <QueryState query={history}>
            {(runs) =>
              runs.length === 0 ? (
                <EmptyRow message="No replay has been run." />
              ) : (
                <>
                  {runs.slice(0, 20).map((run, index, shown) => (
                    <ExpandableRow
                      key={run.runId}
                      last={index === shown.length - 1}
                      summary={
                        <View style={{ gap: 3 }}>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <Text
                              numberOfLines={1}
                              style={{ color: theme.text, fontSize: 14, flex: 1 }}
                            >
                              {run.description || run.runId}
                            </Text>
                            <Pill
                              text={run.state}
                              severity={
                                run.state === "failed"
                                  ? "critical"
                                  : run.state === "cancelled"
                                    ? "warning"
                                    : "normal"
                              }
                            />
                          </View>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {`${run.userName} · ${formatDateTime(run.startedAt)}`}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                            {`${formatCount(run.aggregatesProcessed)} aggregates · ${formatCount(
                              run.eventsProcessed,
                            )} events`}
                          </Text>
                        </View>
                      }
                      detail={
                        <View style={{ gap: 3 }}>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {`Since ${run.since} · ${
                              run.tenantIds.length === 0
                                ? "all tenants"
                                : `${run.tenantIds.length} tenants`
                            }`}
                          </Text>
                          <Text
                            style={{
                              color: theme.textMuted,
                              fontFamily: "Menlo",
                              fontSize: 11,
                            }}
                          >
                            {run.projectionNames.join(", ")}
                          </Text>
                          {run.error ? (
                            <Text style={{ color: theme.critical, fontSize: 12 }}>
                              {run.error}
                            </Text>
                          ) : null}
                        </View>
                      }
                    />
                  ))}
                </>
              )
            }
          </QueryState>
        </Section>

        <Section title="Registered">
          <QueryState query={catalog}>
            {(registry) => (
              <>
                {registry.projections.map((projection) => (
                  <Row key={projection.pauseKey}>
                    <View style={{ gap: 2 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          style={{
                            color: theme.text,
                            fontFamily: "Menlo",
                            fontSize: 12,
                            flex: 1,
                          }}
                        >
                          {projection.projectionName}
                        </Text>
                        <Pill text={projection.kind} />
                      </View>
                      <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                        {`${projection.pipelineName} · ${projection.aggregateType}`}
                      </Text>
                    </View>
                  </Row>
                ))}
                {registry.eventSubscribers.map((subscriber, index, list) => (
                  <Row
                    key={`${subscriber.pipelineName}/${subscriber.subscriberName}`}
                    last={index === list.length - 1}
                  >
                    <View style={{ gap: 2 }}>
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="middle"
                        style={{
                          color: theme.text,
                          fontFamily: "Menlo",
                          fontSize: 12,
                        }}
                      >
                        {subscriber.subscriberName}
                      </Text>
                      <Text
                        numberOfLines={3}
                        style={{ color: theme.textMuted, fontSize: 11 }}
                      >
                        {subscriber.eventTypes.join(", ")}
                      </Text>
                    </View>
                  </Row>
                ))}
              </>
            )}
          </QueryState>
        </Section>
      </Screen>
    </>
  );
}
