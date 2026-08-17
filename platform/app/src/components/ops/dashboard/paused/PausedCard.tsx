import { Card, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { ParkedTenantsSection } from "./ParkedTenantsSection";
import { PausedSchedulesSection } from "./PausedSchedulesSection";
import { PausedSubscribersSection } from "./PausedSubscribersSection";
import { usePausedSchedules } from "./usePausedSchedules";

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
  const schedules = usePausedSchedules();

  const total = parkedTenants.length + schedules.total + pausedKeys.length;
  if (total === 0) return null;

  return (
    <Card.Root overflow="hidden">
      <HStack paddingX={4} paddingTop={3} gap={2}>
        <Text textStyle="sm" fontWeight="medium">
          Switched off
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {describe({
            parkedTenants: parkedTenants.length,
            schedules: schedules.total,
            subscribers: pausedKeys.length,
          })}
        </Text>
      </HStack>
      <VStack align="stretch" gap={0} separator={<Separator />}>
        {sectionsWithContent({
          parkedTenants,
          parkedTenantsBound,
          schedules,
          pausedKeys,
        })}
      </VStack>
    </Card.Root>
  );
}

/**
 * Only the sections that have something to say.
 *
 * Stack's `separator` interleaves by CHILD COUNT, not by what those children
 * render, so a section returning null still earns a rule and the card ends in
 * stray lines under its last table.
 */
function sectionsWithContent({
  parkedTenants,
  parkedTenantsBound,
  schedules,
  pausedKeys,
}: Pick<
  DashboardData,
  "parkedTenants" | "parkedTenantsBound" | "pausedKeys"
> & {
  schedules: ReturnType<typeof usePausedSchedules>;
}) {
  return [
    parkedTenants.length > 0 && (
      <ParkedTenantsSection
        key="parked"
        parkedTenants={parkedTenants}
        parkedTenantsBound={parkedTenantsBound}
      />
    ),
    schedules.total > 0 && (
      <PausedSchedulesSection
        key="schedules"
        schedules={schedules.schedules}
        total={schedules.total}
      />
    ),
    pausedKeys.length > 0 && (
      <PausedSubscribersSection key="subscribers" pausedKeys={pausedKeys} />
    ),
  ].filter((section) => section !== false);
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
