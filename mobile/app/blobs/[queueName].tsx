import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { trpc } from "@/api/trpc";
import { BlobRowActions } from "@/features/actions/rows";
import { formatBytes, formatCount, formatDuration, formatRelativeMs } from "@/lib/format";
import {
  BLOB_SORTS,
  blobSortExplanation,
  blobSortLabel,
  explainSweepOutcome,
  sweepOutcomeSeverity,
  type BlobSort,
} from "@/lib/ops";
import {
  Button,
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
 * One queue's blobs, ordered by whatever the operator is hunting for.
 *
 * The ordering control is the screen's whole point: "largest" answers what is
 * occupying the instance, "unreferenced" answers what could be reclaimed, and
 * "lapsed lease" answers where a worker died mid-flight. Every one of those but
 * `scan` ranks a bounded sample, and the footer says so rather than implying a
 * true top-N it cannot compute.
 */
export default function BlobListScreen() {
  const theme = useTheme();
  const { queueName } = useLocalSearchParams<{ queueName: string }>();

  const [sort, setSort] = useState<BlobSort>("largest");
  const [projectFilter, setProjectFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");

  const blobs = trpc.ops.listBlobs.useQuery({
    queueName,
    sort,
    limit: 50,
    projectId: appliedFilter || null,
  });

  return (
    <>
      <Stack.Screen options={{ title: "Payloads" }} />
      <Screen onRefresh={() => void blobs.refetch()} refreshing={blobs.isRefetching}>
        <Section title="Order" footer={blobSortExplanation(sort)}>
          <Row last>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {BLOB_SORTS.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setSort(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option === sort }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor:
                      option === sort ? theme.accent : "transparent",
                    borderWidth: 1,
                    borderColor: option === sort ? theme.accent : theme.border,
                  }}
                >
                  <Text
                    style={{
                      color: option === sort ? "#ffffff" : theme.text,
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    {blobSortLabel(option)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Row>
        </Section>

        <Section title="Project">
          <Row>
            <TextInput
              value={projectFilter}
              onChangeText={setProjectFilter}
              onSubmitEditing={() => setAppliedFilter(projectFilter.trim())}
              placeholder="Filter by project id"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ color: theme.text, fontSize: 15, paddingVertical: 4 }}
            />
          </Row>
          <Row last>
            <Button
              title={appliedFilter ? "Clear filter" : "Apply filter"}
              onPress={() => {
                if (appliedFilter) {
                  setProjectFilter("");
                  setAppliedFilter("");
                } else {
                  setAppliedFilter(projectFilter.trim());
                }
              }}
            />
          </Row>
        </Section>

        <Section
          title="Payloads"
          footer={
            blobs.data
              ? blobs.data.rankedFromSample
                ? `Ranked from the ${formatCount(
                    blobs.data.sampled,
                  )} payloads examined — the top of that sample, not the top of everything stored.`
                : `Examined ${formatCount(
                    blobs.data.sampled,
                  )} payloads in storage order. This walk is complete and resumable.`
              : undefined
          }
        >
          <QueryState query={blobs}>
            {(page) =>
              page.blobs.length === 0 ? (
                <EmptyRow message="No payloads matched." />
              ) : (
                <>
                  {page.blobs.map((blob, index) => (
                    <ExpandableRow
                      key={`${blob.projectId}/${blob.hash}`}
                      last={index === page.blobs.length - 1}
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
                                fontSize: 11,
                                flex: 1,
                              }}
                            >
                              {blob.hash}
                            </Text>
                            <Text
                              style={{ color: theme.text, fontWeight: "600" }}
                            >
                              {formatBytes(blob.sizeBytes)}
                            </Text>
                          </View>
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
                                color: theme.textMuted,
                                fontSize: 11,
                                flex: 1,
                              }}
                            >
                              {blob.projectId} ·{" "}
                              {blob.liveLeases === 0
                                ? "no live lease"
                                : `${blob.liveLeases} lease${
                                    blob.liveLeases === 1 ? "" : "s"
                                  }`}
                            </Text>
                            <Pill
                              text={blob.sweepOutcome}
                              severity={sweepOutcomeSeverity(blob.sweepOutcome)}
                            />
                            <BlobRowActions blob={blob} />
                          </View>
                        </View>
                      }
                      detail={
                        <View style={{ gap: 4 }}>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {`Expires in ${
                              blob.ttlSeconds === null
                                ? "never — no expiry set"
                                : formatDuration(blob.ttlSeconds)
                            } · ${blob.holderTokens} holder token${
                              blob.holderTokens === 1 ? "" : "s"
                            }`}
                          </Text>
                          {blob.earliestLeaseDeadlineMs !== null ? (
                            <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                              {blob.earliestLeaseDeadlineMs < Date.now()
                                ? `Oldest lease lapsed ${formatRelativeMs(
                                    blob.earliestLeaseDeadlineMs,
                                  )} — where a holder most likely died mid-flight.`
                                : `Earliest lease deadline ${formatRelativeMs(
                                    blob.earliestLeaseDeadlineMs,
                                  )}.`}
                            </Text>
                          ) : null}
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {explainSweepOutcome(blob.sweepOutcome)}
                          </Text>
                        </View>
                      }
                    />
                  ))}
                </>
              )
            }
          </QueryState>
        </Section>

        <Section footer="A payload nothing holds a lease on can be deleted from its row. The sweep on the Storage screen does the same by rule rather than by hand." />
      </Screen>
    </>
  );
}
