import { Badge, Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { TriggerKind } from "@langwatch/automation-contract";
import { AlertTriangle, Calendar, CheckCircle, Zap } from "lucide-react";
import { useMemo } from "react";

export type AutomationActivityFire = {
  id: string;
  triggerId: string;
  customGraphId: string | null;
  createdAt: Date | string;
  resolvedAt: Date | string | null;
};

export type AutomationActivityTrigger = {
  id: string;
  name: string;
  triggerKind: TriggerKind;
};

type ActivityKind = "fired" | "alertOpened" | "alertRecovered" | "reportSent";

export type AutomationActivityEntry = {
  id: string;
  triggerId: string;
  name: string;
  kind: ActivityKind;
  at: Date;
};

const KIND_META: Record<ActivityKind, { label: string; icon: typeof Zap; palette: string }> = {
  fired: { label: "Matched", icon: Zap, palette: "blue" },
  alertOpened: { label: "Started firing", icon: AlertTriangle, palette: "red" },
  alertRecovered: { label: "Recovered", icon: CheckCircle, palette: "green" },
  reportSent: { label: "Sent", icon: Calendar, palette: "purple" },
};

function dayKeyOf(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function dayLabelOf(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  if (dayKeyOf(date) === dayKeyOf(today)) {
    return "Today";
  }

  if (dayKeyOf(date) === dayKeyOf(yesterday)) {
    return "Yesterday";
  }

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function activityKind(input: { isAlert: boolean; isReport: boolean }): ActivityKind {
  if (input.isAlert) {
    return "alertOpened";
  }

  if (input.isReport) {
    return "reportSent";
  }

  return "fired";
}

export function toAutomationActivityEntries({
  fires,
  triggersById,
}: {
  fires: readonly AutomationActivityFire[];
  triggersById: ReadonlyMap<string, AutomationActivityTrigger>;
}): AutomationActivityEntry[] {
  const entries: AutomationActivityEntry[] = [];

  for (const fire of fires) {
    const trigger = triggersById.get(fire.triggerId);
    const name = trigger?.name ?? "Deleted automation";
    const isAlert = fire.customGraphId !== null;
    const isReport = trigger?.triggerKind === "REPORT";

    entries.push({
      id: fire.id,
      triggerId: fire.triggerId,
      name,
      kind: activityKind({ isAlert, isReport }),
      at: new Date(fire.createdAt),
    });

    if (isAlert && fire.resolvedAt) {
      entries.push({
        id: `${fire.id}:resolved`,
        triggerId: fire.triggerId,
        name,
        kind: "alertRecovered",
        at: new Date(fire.resolvedAt),
      });
    }
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function AutomationHistory({
  fires,
  triggers,
  isLoading,
  onOpenAutomation,
  formatTimeAgo,
}: {
  fires: readonly AutomationActivityFire[];
  triggers: readonly AutomationActivityTrigger[];
  isLoading: boolean;
  onOpenAutomation: (triggerId: string) => void;
  formatTimeAgo: (timestamp: number) => string | undefined;
}) {
  const triggersById = useMemo(
    () => new Map(triggers.map((trigger) => [trigger.id, trigger])),
    [triggers],
  );
  const days = useMemo(() => {
    const entries = toAutomationActivityEntries({ fires, triggersById });
    const grouped = new Map<string, AutomationActivityEntry[]>();

    for (const entry of entries) {
      const key = dayKeyOf(entry.at);
      const bucket = grouped.get(key);
      if (bucket) {
        bucket.push(entry);
      } else {
        grouped.set(key, [entry]);
      }
    }

    return [...grouped.values()];
  }, [fires, triggersById]);

  if (isLoading) {
    return (
      <HStack gap={2} color="fg.muted" padding={4}>
        <Spinner size="xs" />
        <Text textStyle="sm">Loading activity…</Text>
      </HStack>
    );
  }

  if (days.length === 0) {
    return (
      <Box
        borderWidth="1px"
        borderStyle="dashed"
        borderColor="border"
        borderRadius="lg"
        padding={8}
        textAlign="center"
      >
        <Text textStyle="sm" color="fg.muted">
          Nothing has fired yet. When your automations, alerts, and reports run, you'll see what
          they did here.
        </Text>
      </Box>
    );
  }

  return (
    <VStack align="stretch" gap={6}>
      {days.map((entries) => (
        <VStack align="stretch" gap={0} key={dayKeyOf(entries[0]!.at)}>
          <Text textStyle="xs" fontWeight="semibold" color="fg.muted" paddingBottom={2}>
            {dayLabelOf(entries[0]!.at)}
          </Text>
          <VStack
            align="stretch"
            gap={0}
            borderWidth="1px"
            borderColor="border.emphasized"
            borderRadius="md"
            overflow="hidden"
            separator={<Box height="1px" bg="border.muted" />}
          >
            {entries.map((entry) => (
              <ActivityRow
                key={entry.id}
                entry={entry}
                formatTimeAgo={formatTimeAgo}
                onOpen={() => onOpenAutomation(entry.triggerId)}
              />
            ))}
          </VStack>
        </VStack>
      ))}
    </VStack>
  );
}

function ActivityRow({
  entry,
  formatTimeAgo,
  onOpen,
}: {
  entry: AutomationActivityEntry;
  formatTimeAgo: (timestamp: number) => string | undefined;
  onOpen: () => void;
}) {
  const meta = KIND_META[entry.kind];
  const Icon = meta.icon;

  return (
    <HStack
      gap={3}
      paddingX={4}
      paddingY={2.5}
      cursor="pointer"
      _hover={{ bg: "bg.muted" }}
      onClick={onOpen}
    >
      <Box color={`${meta.palette}.fg`} display="inline-flex" flexShrink={0}>
        <Icon size={14} />
      </Box>
      <Text textStyle="sm" fontWeight="medium" flexShrink={0}>
        {entry.name}
      </Text>
      <Badge size="sm" colorPalette={meta.palette} variant="subtle">
        {meta.label}
      </Badge>
      <Box flex="1" />
      <Text textStyle="xs" color="fg.muted" flexShrink={0} title={entry.at.toLocaleString()}>
        {formatTimeAgo(entry.at.getTime()) ?? "—"}
      </Text>
    </HStack>
  );
}
