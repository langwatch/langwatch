import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

import { trpc } from "@/api/trpc";
import { GroupRowActions, JobRowActions } from "@/features/actions/rows";
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatMilliseconds,
  formatRelativeMs,
} from "@/lib/format";
import {
  DetailRow,
  EmptyRow,
  QueryState,
  Row,
  Screen,
  Section,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/** One group: why it is stuck, and what is waiting behind it. */
export default function GroupDetailScreen() {
  const theme = useTheme();
  const { queueName, groupId } = useLocalSearchParams<{
    queueName: string;
    groupId: string;
  }>();

  const group = trpc.ops.getGroupDetail.useQuery({ queueName, groupId });

  // The payload-free variant. The full `getGroupJobs` exists and the web
  // console uses it; a phone gets the shape and the size, never the contents.
  const jobs = trpc.ops.getGroupJobSummaries.useQuery({
    queueName,
    groupId,
    page: 1,
    pageSize: 20,
  });

  // Narrowed once: both the header action and the per-job retry need to know
  // whether the group is blocked, and neither can read it from a job row.
  const groupSummary = group.data
    ? {
        groupId: group.data.groupId,
        isBlocked: group.data.isBlocked,
        pendingJobs: group.data.pendingJobs,
      }
    : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Group",
          headerRight: groupSummary
            ? () => (
                <GroupRowActions queueName={queueName} group={groupSummary} />
              )
            : undefined,
        }}
      />
      <Screen
        onRefresh={() => {
          void group.refetch();
          void jobs.refetch();
        }}
        refreshing={group.isRefetching}
      >
        <QueryState query={group}>
          {(detail) => (
            <>
              <Section title="Group">
                <DetailRow label="Id" value={detail.groupId} mono />
                <DetailRow label="Queue" value={queueName} mono />
                {detail.pipelineName ? (
                  <DetailRow label="Pipeline" value={detail.pipelineName} mono />
                ) : null}
                {detail.jobName ? (
                  <DetailRow label="Job" value={detail.jobName} mono />
                ) : null}
                <DetailRow
                  label="Pending jobs"
                  value={formatCount(detail.pendingJobs)}
                  last
                />
              </Section>

              <Section
                title="State"
                footer={
                  detail.isStaleBlock
                    ? "Stale block — nothing is retrying this any more."
                    : undefined
                }
              >
                <DetailRow label="Blocked" value={detail.isBlocked ? "Yes" : "No"} />
                {detail.retryCount !== null ? (
                  <DetailRow label="Retries" value={String(detail.retryCount)} />
                ) : null}
                {detail.activeJobId ? (
                  <DetailRow label="Active job" value={detail.activeJobId} mono />
                ) : null}
                {detail.activeKeyTtlSec !== null ? (
                  <DetailRow
                    label="Lock expires in"
                    value={formatDuration(detail.activeKeyTtlSec)}
                  />
                ) : null}
                {detail.processingDurationMs !== null ? (
                  <DetailRow
                    label="Processing for"
                    value={formatMilliseconds(detail.processingDurationMs)}
                  />
                ) : null}
                <DetailRow
                  label="Oldest job"
                  value={
                    detail.oldestJobMs ? formatRelativeMs(detail.oldestJobMs) : "—"
                  }
                  last
                />
              </Section>

              {detail.errorMessage ? (
                <Section title="Error">
                  <Row last={!detail.errorStack}>
                    <Text selectable style={{ color: theme.critical, fontSize: 14 }}>
                      {detail.errorMessage}
                    </Text>
                  </Row>
                  {detail.errorStack ? (
                    <Row last>
                      <Text
                        selectable
                        style={{
                          color: theme.textMuted,
                          fontFamily: "Menlo",
                          fontSize: 10,
                        }}
                      >
                        {detail.errorStack}
                      </Text>
                    </Row>
                  ) : null}
                </Section>
              ) : null}
            </>
          )}
        </QueryState>

        <Section
          title="Queued jobs"
          footer="Job payloads stay on the server. This lists what each job carries and how big it is, never its contents."
        >
          <QueryState query={jobs}>
            {(page) =>
              page.jobs.length === 0 ? (
                <EmptyRow message="No jobs are queued in this group." />
              ) : (
                <>
                  {page.jobs.map((job, index) => (
                    <Row key={job.jobId} last={index === page.jobs.length - 1}>
                      <View style={{ gap: 2 }}>
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
                              fontSize: 11,
                              flex: 1,
                            }}
                          >
                            {job.jobId}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                            {formatBytes(job.payloadBytes)}
                          </Text>
                          {groupSummary ? (
                            <JobRowActions
                              queueName={queueName}
                              group={groupSummary}
                              jobId={job.jobId}
                            />
                          ) : null}
                        </View>
                        {job.payloadKeys.length > 0 ? (
                          <Text
                            numberOfLines={2}
                            style={{ color: theme.textMuted, fontSize: 11 }}
                          >
                            {job.payloadKeys.join(", ")}
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
      </Screen>
    </>
  );
}
