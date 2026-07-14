import {
  Badge,
  Center,
  EmptyState,
  HStack,
  Spinner,
  Table,
  Text,
} from "@chakra-ui/react";
import { CalendarClock } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { api } from "~/utils/api";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const deltaMs = then - Date.now();
  const abs = Math.abs(deltaMs);
  const mins = Math.round(abs / 60_000);
  const rel =
    mins < 1
      ? "just now"
      : mins < 60
        ? `${mins}m`
        : mins < 1440
          ? `${Math.round(mins / 60)}h`
          : `${Math.round(mins / 1440)}d`;
  const suffix = deltaMs >= 0 ? `in ${rel}` : `${rel} ago`;
  return `${new Date(iso).toLocaleString()} (${mins < 1 ? rel : suffix})`;
}

export default function OpsSchedulerPage() {
  const jobs = api.ops.listScheduledJobs.useQuery(
    { limit: 200 },
    { refetchInterval: 10_000 },
  );

  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Scheduler</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <Text textStyle="sm" color="fg.muted" marginBottom={4}>
            Durable <code>ScheduledJob</code> entries driving the in-process
            calendar scheduler (reports and other schedule-triggered work). When
            each next fires, when it last fired, and whether it is active.
          </Text>
          {jobs.isLoading ? (
            <Center paddingY={20}>
              <EmptyState.Root>
                <EmptyState.Content>
                  <EmptyState.Indicator>
                    <Spinner size="lg" />
                  </EmptyState.Indicator>
                  <EmptyState.Title>Loading scheduled jobs</EmptyState.Title>
                </EmptyState.Content>
              </EmptyState.Root>
            </Center>
          ) : (jobs.data?.length ?? 0) === 0 ? (
            <Center paddingY={20}>
              <EmptyState.Root>
                <EmptyState.Content>
                  <EmptyState.Indicator>
                    <CalendarClock />
                  </EmptyState.Indicator>
                  <EmptyState.Title>No scheduled jobs</EmptyState.Title>
                  <EmptyState.Description>
                    Nothing is on the calendar scheduler yet.
                  </EmptyState.Description>
                </EmptyState.Content>
              </EmptyState.Root>
            </Center>
          ) : (
            <Table.Root variant="line" size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Target</Table.ColumnHeader>
                  <Table.ColumnHeader>Project</Table.ColumnHeader>
                  <Table.ColumnHeader>Schedule</Table.ColumnHeader>
                  <Table.ColumnHeader>Next run</Table.ColumnHeader>
                  <Table.ColumnHeader>Last fired</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {jobs.data?.map((job) => (
                  <Table.Row key={job.id}>
                    <Table.Cell>
                      <HStack gap={2}>
                        <Badge colorPalette="purple" variant="subtle">
                          {job.targetType}
                        </Badge>
                        <Text textStyle="xs" color="fg.muted" fontFamily="mono">
                          {job.targetId}
                        </Text>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" fontFamily="mono">
                        {job.projectId}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" fontFamily="mono">
                        {job.cron}
                      </Text>
                      <Text textStyle="xs" color="fg.muted">
                        {job.timezone}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>{formatWhen(job.nextRunAt)}</Table.Cell>
                    <Table.Cell>{formatWhen(job.lastSlot)}</Table.Cell>
                    <Table.Cell>
                      {job.active ? (
                        <Badge colorPalette="green" variant="subtle">
                          Active
                        </Badge>
                      ) : (
                        <Badge colorPalette="gray" variant="subtle">
                          Inactive
                        </Badge>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
