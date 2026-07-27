import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { trpc } from "@/api/trpc";
import { formatCount } from "@/lib/format";
import { orderQueues } from "@/lib/ops";
import {
  EmptyRow,
  Pill,
  QueryState,
  Row,
  Screen,
  Section,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/** Queues, ranked by trouble rather than by name. */
export default function QueuesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queues = trpc.ops.listQueues.useQuery();

  return (
    <Screen
      onRefresh={() => void queues.refetch()}
      refreshing={queues.isRefetching}
    >
      <Section
        title="Queues"
        footer="A queue with blocked groups sorts above a busier healthy one: a backlog drains on its own and a block does not."
      >
        <QueryState query={queues}>
          {(list) =>
            list.length === 0 ? (
              <EmptyRow message="No group queues are registered on this instance." />
            ) : (
              <>
                {orderQueues(list).map((queue, index) => (
                  <Row
                    key={queue.name}
                    last={index === list.length - 1}
                    onPress={() =>
                      router.push({
                        pathname: "/queue/[queueName]",
                        params: {
                          queueName: queue.name,
                          displayName: queue.displayName,
                        },
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
                          style={{
                            color: theme.text,
                            fontSize: 16,
                            fontWeight: "600",
                            flex: 1,
                          }}
                          numberOfLines={1}
                        >
                          {queue.displayName}
                        </Text>
                        {queue.blockedGroupCount > 0 ? (
                          <Pill
                            text={`${queue.blockedGroupCount} blocked`}
                            severity="critical"
                          />
                        ) : null}
                        {queue.dlqCount > 0 ? (
                          <Pill
                            text={`${queue.dlqCount} dead`}
                            severity="warning"
                          />
                        ) : null}
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={theme.textMuted}
                        />
                      </View>
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                        {summarize(queue)}
                      </Text>
                    </View>
                  </Row>
                ))}
              </>
            )
          }
        </QueryState>
      </Section>
    </Screen>
  );
}

function summarize(queue: {
  pendingGroupCount: number;
  activeGroupCount: number;
  totalPendingJobs: number;
  parkedGroupCount: number;
}): string {
  const parts = [
    `${formatCount(queue.pendingGroupCount)} pending`,
    `${formatCount(queue.activeGroupCount)} active`,
    `${formatCount(queue.totalPendingJobs)} jobs`,
  ];
  if (queue.parkedGroupCount > 0) {
    parts.push(`${formatCount(queue.parkedGroupCount)} parked`);
  }
  return parts.join(" · ");
}
