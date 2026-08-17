import { Card, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";
import { ParkedTenantsSection } from "./ParkedTenantsSection";
import {
  type PausedSchedule,
  PausedSchedulesSection,
} from "./PausedSchedulesSection";
import { PausedSubscribersSection } from "./PausedSubscribersSection";

/**
 * How many schedules to read when counting the switched-off ones.
 *
 * The procedure caps at 500 and there is no server-side `active` filter, so
 * this reads a page and filters it. The count below states when the page was
 * full, because a silently truncated list reads as "that is all of them".
 */
const SCHEDULE_PAGE_SIZE = 200;

/**
 * Everything that is deliberately not running.
 *
 * Three mechanisms answer one question — "what is switched off?" — and until
 * this panel each answered it somewhere else: parked tenants on the dashboard,
 * switched-off schedules on the schedules page, paused subscribers on the
 * subscribers page. An operator asking why work is not happening had to know
 * which of the three to suspect before they could look, so the common case
 * (someone paused something during an incident and never resumed it) was the
 * one the pages were worst at reporting.
 *
 * They stay three sections rather than one merged table, because the fix
 * differs: parking clears itself when capacity frees, a schedule and a
 * subscriber each need a human to switch them back on. The panel states the
 * shared fact and keeps the mechanisms distinguishable.
 *
 * Nothing switched off renders nothing at all — an empty card costs a third of
 * a viewport to say what the strip already says (ops-dashboard.md).
 */
export function PausedCard({
  parkedTenants,
  parkedTenantsBound,
  pausedKeys,
}: Pick<DashboardData, "parkedTenants" | "parkedTenantsBound" | "pausedKeys">) {
  const schedulesQuery = api.ops.listScheduledJobs.useQuery(
    { limit: SCHEDULE_PAGE_SIZE },
    { refetchInterval: 30_000 },
  );

  const jobs = schedulesQuery.data;
  const pausedSchedules = useMemo<PausedSchedule[]>(
    () =>
      (jobs ?? [])
        .filter((job) => !job.active)
        .map((job) => ({
          id: job.id,
          targetType: job.targetType,
          targetId: job.targetId,
          cron: job.cron,
        })),
    [jobs],
  );
  const schedulePageWasFull = (jobs ?? []).length >= SCHEDULE_PAGE_SIZE;

  const total =
    parkedTenants.length + pausedSchedules.length + pausedKeys.length;
  if (total === 0) return null;

  // Only the sections that have something to say, so the rules between them
  // land between rendered content. Stack's own `separator` interleaves by
  // CHILD COUNT, not by what those children render — a section returning null
  // still counts, and the card ends in stray rules under its last table.
  const sections = [
    parkedTenants.length > 0 && (
      <ParkedTenantsSection
        key="parked"
        parkedTenants={parkedTenants}
        parkedTenantsBound={parkedTenantsBound}
      />
    ),
    pausedSchedules.length > 0 && (
      <PausedSchedulesSection key="schedules" schedules={pausedSchedules} />
    ),
    pausedKeys.length > 0 && (
      <PausedSubscribersSection key="subscribers" pausedKeys={pausedKeys} />
    ),
  ].filter((section) => section !== false);

  return (
    <Card.Root overflow="hidden">
      <HStack paddingX={4} paddingTop={3} gap={2}>
        <Text textStyle="sm" fontWeight="medium">
          Switched off
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {describe({
            parkedTenants: parkedTenants.length,
            schedules: pausedSchedules.length,
            subscribers: pausedKeys.length,
          })}
        </Text>
      </HStack>
      <VStack align="stretch" gap={0} separator={<Separator />}>
        {sections}
      </VStack>
      {schedulePageWasFull && (
        <Text
          paddingX={4}
          paddingBottom={3}
          paddingTop={2}
          textStyle="xs"
          color="fg.muted"
        >
          Counted against the {SCHEDULE_PAGE_SIZE} most recent schedules; there
          may be more switched off beyond them.
        </Text>
      )}
    </Card.Root>
  );
}

/**
 * The one-line summary, naming only the mechanisms that have something to
 * report. A summary that always lists all three trains the reader to skip it.
 */
function describe({
  parkedTenants,
  schedules,
  subscribers,
}: {
  parkedTenants: number;
  schedules: number;
  subscribers: number;
}): string {
  const parts: string[] = [];
  if (parkedTenants > 0) {
    parts.push(`${parkedTenants} parked ${plural(parkedTenants, "tenant")}`);
  }
  if (schedules > 0) {
    parts.push(`${schedules} ${plural(schedules, "schedule")}`);
  }
  if (subscribers > 0) {
    parts.push(`${subscribers} ${plural(subscribers, "subscriber")}`);
  }
  return parts.join(" · ");
}

const plural = (count: number, word: string) =>
  count === 1 ? word : `${word}s`;
