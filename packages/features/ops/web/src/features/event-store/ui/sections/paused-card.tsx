import { Card, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type { ParkedTenant } from "@langwatch/ops-contract";
import type { ReactNode } from "react";
import { ParkedTenantsSection, type ParkedGroupsRender } from "../blocks/parked-tenants-section";
import type { PausedSchedule } from "../elements/paused-schedules-section";
import { PausedSchedulesSection } from "../elements/paused-schedules-section";
import { PausedSubscribersSection } from "../elements/paused-subscribers-section";

export interface PausedCardProps {
  parkedTenants: ParkedTenant[];
  parkedTenantsBound: { total: number; included: number };
  pausedKeys: string[];
  schedules: PausedSchedule[];
  schedulesTotal: number;
  renderParkedGroups?: ParkedGroupsRender;
  renderSchedulesLink?: (href: string) => ReactNode;
  renderSubscribersLink?: (href: string) => ReactNode;
}

/** Groups the three distinct mechanisms which can deliberately stop work. */
export function PausedCard({
  parkedTenants,
  parkedTenantsBound,
  pausedKeys,
  schedules,
  schedulesTotal,
  renderParkedGroups,
  renderSchedulesLink,
  renderSubscribersLink,
}: PausedCardProps) {
  const total = parkedTenants.length + schedulesTotal + pausedKeys.length;
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
            schedules: schedulesTotal,
            subscribers: pausedKeys.length,
          })}
        </Text>
      </HStack>
      <VStack align="stretch" gap={0} separator={<Separator />}>
        {sectionsWithContent({
          parkedTenants,
          parkedTenantsBound,
          schedules,
          schedulesTotal,
          pausedKeys,
          renderParkedGroups,
          renderSchedulesLink,
          renderSubscribersLink,
        })}
      </VStack>
    </Card.Root>
  );
}

/** Excludes empty children because Chakra still separates children which render null. */
function sectionsWithContent({
  parkedTenants,
  parkedTenantsBound,
  schedules,
  schedulesTotal,
  pausedKeys,
  renderParkedGroups,
  renderSchedulesLink,
  renderSubscribersLink,
}: PausedCardProps) {
  return [
    parkedTenants.length > 0 && (
      <ParkedTenantsSection
        key="parked"
        parkedTenants={parkedTenants}
        parkedTenantsBound={parkedTenantsBound}
        renderParkedGroups={renderParkedGroups}
      />
    ),
    schedulesTotal > 0 && (
      <PausedSchedulesSection
        key="schedules"
        schedules={schedules}
        total={schedulesTotal}
        renderSchedulesLink={renderSchedulesLink}
      />
    ),
    pausedKeys.length > 0 && (
      <PausedSubscribersSection
        key="subscribers"
        pausedKeys={pausedKeys}
        renderSubscribersLink={renderSubscribersLink}
      />
    ),
  ].filter((section) => section !== false);
}

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

const plural = (count: number, word: string) => (count === 1 ? word : `${word}s`);
