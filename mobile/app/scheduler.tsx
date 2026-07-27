import { Stack } from "expo-router";
import { Text, View } from "react-native";

import { trpc } from "@/api/trpc";
import { formatDateTime } from "@/lib/format";
import { orderSchedules, scheduleIsStruggling } from "@/lib/ops";
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
 * The calendar scheduler, read-only.
 *
 * Schedules that are struggling — a rising attempt count with a last error —
 * sort to the top, because a schedule that quietly stopped firing is exactly the
 * failure nobody notices until a customer does.
 */
export default function SchedulerScreen() {
  const theme = useTheme();
  const jobs = trpc.ops.listScheduledJobs.useQuery({ limit: 200 });

  return (
    <>
      <Stack.Screen options={{ title: "Scheduler" }} />
      <Screen onRefresh={() => void jobs.refetch()} refreshing={jobs.isRefetching}>
        <Section
          title="Schedules"
          footer="Firing, pausing and editing a schedule all happen in the web console."
        >
          <QueryState query={jobs}>
            {(list) =>
              list.length === 0 ? (
                <EmptyRow message="Nothing is scheduled." />
              ) : (
                <>
                  {orderSchedules(list).map((job, index) => (
                    <ExpandableRow
                      key={job.id}
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
                              style={{
                                color: theme.text,
                                fontSize: 15,
                                fontWeight: "600",
                                flex: 1,
                              }}
                              numberOfLines={1}
                            >
                              {job.targetType}
                            </Text>
                            {scheduleIsStruggling(job) ? (
                              <Pill
                                text={`${job.attempts} attempts`}
                                severity="critical"
                              />
                            ) : !job.active ? (
                              <Pill text="inactive" severity="warning" />
                            ) : job.currentSlot ? (
                              <Pill text="running" />
                            ) : null}
                          </View>
                          <Text
                            style={{
                              color: theme.textMuted,
                              fontFamily: "Menlo",
                              fontSize: 11,
                            }}
                          >
                            {`${job.cron} · ${job.timezone}`}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {`Next ${formatDateTime(job.nextRunAt)}`}
                          </Text>
                          {job.lastError ? (
                            <Text
                              numberOfLines={2}
                              style={{ color: theme.critical, fontSize: 12 }}
                            >
                              {job.lastError}
                            </Text>
                          ) : null}
                        </View>
                      }
                      detail={
                        <View style={{ gap: 3 }}>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {`Project ${job.projectId} · target ${job.targetId}`}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {job.currentSlot
                              ? `Working slot ${formatDateTime(job.currentSlot)}`
                              : "Idle"}
                            {job.lastSlot
                              ? ` · last slot ${formatDateTime(job.lastSlot)}`
                              : ""}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            A claimed slot with a rising attempt count is a job
                            failing and retrying, not one running long — the
                            scheduler records no lease holder.
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
      </Screen>
    </>
  );
}
