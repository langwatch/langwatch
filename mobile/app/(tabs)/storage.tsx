import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { trpc } from "@/api/trpc";
import { formatBytes, formatCount } from "@/lib/format";
import {
  Button,
  EmptyRow,
  QueryState,
  Row,
  Screen,
  Section,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

import { SweepSheet } from "@/features/SweepSheet";

/** The payload store: where the bytes are, and what a sweep would do about it. */
export default function StorageScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [sweeping, setSweeping] = useState(false);

  const stats = trpc.ops.getBlobStoreStats.useQuery();

  return (
    <Screen onRefresh={() => void stats.refetch()} refreshing={stats.isRefetching}>
      <Section
        title="Queues"
        footer="Counts are sampled. A full count of a multi-million-key keyspace is not something a request can do."
      >
        <QueryState query={stats}>
          {({ queues }) =>
            queues.length === 0 ? (
              <EmptyRow message="No queues are holding payloads." />
            ) : (
              <>
                {queues.map((queue, index) => (
                  <Row
                    key={queue.queueName}
                    last={index === queues.length - 1}
                    onPress={() =>
                      router.push({
                        pathname: "/blobs/[queueName]",
                        params: { queueName: queue.queueName },
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
                          {queue.queueName}
                        </Text>
                        <Text style={{ color: theme.text, fontWeight: "600" }}>
                          {formatBytes(queue.sampledBytes)}
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={14}
                          color={theme.textMuted}
                        />
                      </View>
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                        {`${formatCount(queue.sampledBlobs)} sampled`}
                        {queue.unreferenced > 0
                          ? ` · ${formatCount(queue.unreferenced)} unreferenced`
                          : ""}
                        {queue.truncated ? " · sample capped" : ""}
                      </Text>
                    </View>
                  </Row>
                ))}
              </>
            )
          }
        </QueryState>
      </Section>

      <Section footer="Trial it first. The trial reports exactly what a real sweep would reclaim, without deleting anything.">
        <Row last>
          <Button title="Run a cleanup sweep" onPress={() => setSweeping(true)} />
        </Row>
      </Section>

      <SweepSheet
        visible={sweeping}
        onClose={() => setSweeping(false)}
        onReclaimed={() => void stats.refetch()}
      />
    </Screen>
  );
}
