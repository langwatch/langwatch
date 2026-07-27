import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";

import { trpc } from "@/api/trpc";
import { formatCount, formatDuration } from "@/lib/format";
import { orderGroups } from "@/lib/ops";
import {
  EmptyRow,
  Pill,
  QueryState,
  Row,
  Screen,
  Section,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/**
 * One queue: its groups, and the pauses currently applied to it.
 *
 * Everything here is read-only — unblocking, draining and redriving stay on the
 * web console, where the operator has the room to see what they are about to do.
 */
export default function QueueDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    queueName: string;
    displayName?: string;
  }>();
  const queueName = params.queueName;

  const groups = trpc.ops.listGroups.useQuery({ queueName, page: 1, pageSize: 50 });
  const pausedKeys = trpc.ops.listPausedKeys.useQuery({ queueName });
  const pausedTenants = trpc.ops.listPausedTenants.useQuery({ queueName });

  const refresh = () => {
    void groups.refetch();
    void pausedKeys.refetch();
    void pausedTenants.refetch();
  };

  const paused = [
    ...(pausedKeys.data ?? []).map((key) => ({ kind: "key" as const, value: key })),
    ...(pausedTenants.data ?? []).map((tenant) => ({
      kind: "tenant" as const,
      value: tenant,
    })),
  ];

  return (
    <>
      <Stack.Screen options={{ title: params.displayName ?? queueName }} />
      <Screen onRefresh={refresh} refreshing={groups.isRefetching}>
        <Section
          title="Groups"
          footer={
            groups.data && groups.data.total > groups.data.groups.length
              ? `Showing ${groups.data.groups.length} of ${formatCount(
                  groups.data.total,
                )}. Open the web console for the full list.`
              : undefined
          }
        >
          <QueryState query={groups}>
            {(page) =>
              page.groups.length === 0 ? (
                <EmptyRow message="No groups are queued." />
              ) : (
                <>
                  {orderGroups(page.groups).map((group, index) => (
                    <Row
                      key={group.groupId}
                      last={index === page.groups.length - 1}
                      onPress={() =>
                        router.push({
                          pathname: "/group",
                          params: { queueName, groupId: group.groupId },
                        })
                      }
                    >
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
                            {group.groupId}
                          </Text>
                          {group.isBlocked ? (
                            <Pill
                              text={group.isStaleBlock ? "stale" : "blocked"}
                              severity="critical"
                            />
                          ) : group.hasActiveJob ? (
                            <Pill text="active" />
                          ) : null}
                          <Ionicons
                            name="chevron-forward"
                            size={14}
                            color={theme.textMuted}
                          />
                        </View>
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                          {describeGroup(group)}
                        </Text>
                        {group.errorMessage ? (
                          <Text
                            numberOfLines={2}
                            style={{ color: theme.critical, fontSize: 12 }}
                          >
                            {group.errorMessage}
                          </Text>
                        ) : null}
                      </View>
                    </Row>
                  ))}
                </>
              )
            }
          </QueryState>
        </Section>

        {paused.length > 0 ? (
          <Section
            title="Paused"
            footer="Pausing and unpausing happen in the web console."
          >
            {paused.map((entry, index) => (
              <Row key={`${entry.kind}:${entry.value}`} last={index === paused.length - 1}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Ionicons
                    name={entry.kind === "key" ? "pause-circle-outline" : "person-outline"}
                    size={16}
                    color={theme.textMuted}
                  />
                  <Text
                    style={{ color: theme.text, fontFamily: "Menlo", fontSize: 12 }}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  >
                    {entry.value}
                  </Text>
                </View>
              </Row>
            ))}
          </Section>
        ) : null}
      </Screen>
    </>
  );
}

function describeGroup(group: {
  pendingJobs: number;
  pipelineName: string | null;
  oldestJobMs: number | null;
}): string {
  const parts = [`${formatCount(group.pendingJobs)} jobs`];
  if (group.pipelineName) parts.push(group.pipelineName);
  if (group.oldestJobMs) {
    const ageSeconds = (Date.now() - group.oldestJobMs) / 1000;
    if (ageSeconds > 0) parts.push(`oldest ${formatDuration(ageSeconds)}`);
  }
  return parts.join(" · ");
}
