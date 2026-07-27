import { Text, View } from "react-native";

import { trpc } from "@/api/trpc";
import { formatCount, formatRate, formatRelativeMs } from "@/lib/format";
import { multipleOfBaseline } from "@/lib/ops";
import {
  EmptyRow,
  ExpandableRow,
  Pill,
  QueryState,
  Screen,
  Section,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/**
 * What is broken, in one place: anomalies, dead letters, blocked-by-error.
 *
 * These are three separate pages on the web, but on a phone they answer the same
 * question — "is anything on fire" — so they share a screen and a pull to
 * refresh. Rows expand in place rather than pushing a route: these are leaves,
 * and a navigation stack for a leaf is friction with no payoff.
 */
export default function HealthScreen() {
  const theme = useTheme();

  const anomalies = trpc.ops.listAnomalies.useQuery();
  const deadLetters = trpc.ops.listAllDlqGroups.useQuery();
  const blocked = trpc.ops.getBlockedSummary.useQuery();

  const refresh = () => {
    void anomalies.refetch();
    void deadLetters.refetch();
    void blocked.refetch();
  };

  return (
    <Screen onRefresh={refresh} refreshing={anomalies.isRefetching}>
      <Section
        title="Anomalies"
        footer="Hard tier first. Dismissing an anomaly happens in the web console."
      >
        <QueryState query={anomalies}>
          {({ anomalies: list }) =>
            list.length === 0 ? (
              <EmptyRow message="No tenant anomalies are active." />
            ) : (
              <>
                {list.map((anomaly, index) => {
                  const multiple = multipleOfBaseline(anomaly);
                  return (
                    <ExpandableRow
                      key={`${anomaly.kind}:${anomaly.tenantId}`}
                      last={index === list.length - 1}
                      summary={
                        <View style={{ gap: 4 }}>
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
                              {anomaly.tenantId}
                            </Text>
                            <Pill
                              text={anomaly.tier}
                              severity={
                                anomaly.tier === "hard" ? "critical" : "warning"
                              }
                            />
                          </View>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {`${formatRate(anomaly.currentRate)}/s against a ${formatRate(
                              anomaly.baseline,
                            )}/s baseline`}
                            {multiple === null
                              ? ""
                              : ` (${multiple.toFixed(1)}×)`}
                            {` · ${formatRelativeMs(anomaly.triggeredAt)}`}
                          </Text>
                        </View>
                      }
                      detail={
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                          {anomaly.reason}
                        </Text>
                      }
                    />
                  );
                })}
              </>
            )
          }
        </QueryState>
      </Section>

      <Section title="Dead letters">
        <QueryState query={deadLetters}>
          {(groups) =>
            groups.length === 0 ? (
              <EmptyRow message="Nothing has been dead-lettered." />
            ) : (
              <>
                {groups.slice(0, 50).map((group, index, shown) => (
                  <ExpandableRow
                    key={`${group.queueName}/${group.groupId}`}
                    last={index === shown.length - 1}
                    summary={
                      <View style={{ gap: 4 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
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
                            {group.groupId}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {formatCount(group.jobCount)} jobs
                          </Text>
                        </View>
                        {group.error ? (
                          <Text
                            numberOfLines={2}
                            style={{ color: theme.critical, fontSize: 12 }}
                          >
                            {group.error}
                          </Text>
                        ) : null}
                        <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                          {[
                            group.queueDisplayName,
                            group.pipelineName,
                            group.movedAt ? formatRelativeMs(group.movedAt) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                    }
                    detail={
                      <Text
                        selectable
                        style={{
                          color: theme.textMuted,
                          fontFamily: "Menlo",
                          fontSize: 10,
                        }}
                      >
                        {group.errorStack ??
                          "Replaying from the dead letter queue happens in the web console."}
                      </Text>
                    }
                  />
                ))}
              </>
            )
          }
        </QueryState>
      </Section>

      <Section
        title="Blocked by error"
        footer={
          blocked.data && blocked.data.totalBlocked > 0
            ? `${formatCount(blocked.data.totalBlocked)} blocked groups across ${
                blocked.data.clusters.length
              } distinct errors.`
            : undefined
        }
      >
        <QueryState query={blocked}>
          {(summary) =>
            summary.clusters.length === 0 ? (
              <EmptyRow message="Nothing is blocked." />
            ) : (
              <>
                {summary.clusters.slice(0, 20).map((cluster, index, shown) => (
                  <ExpandableRow
                    key={`${cluster.queueName}/${cluster.normalizedMessage}`}
                    last={index === shown.length - 1}
                    summary={
                      <View style={{ gap: 4 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <Text
                            numberOfLines={2}
                            style={{ color: theme.text, fontSize: 13, flex: 1 }}
                          >
                            {cluster.sampleMessage}
                          </Text>
                          <Text
                            style={{ color: theme.critical, fontWeight: "700" }}
                          >
                            {formatCount(cluster.count)}
                          </Text>
                        </View>
                        <Text style={{ color: theme.textMuted, fontSize: 11 }}>
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
                      </View>
                    }
                  />
                ))}
              </>
            )
          }
        </QueryState>
      </Section>
    </Screen>
  );
}
