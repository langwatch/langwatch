import { Badge, Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, Calendar, CheckCircle, Zap } from "lucide-react";
import { useMemo } from "react";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import type { RouterOutputs } from "~/utils/api";

type TriggerFire = RouterOutputs["automation"]["getRecentActivity"][number];
type EnhancedTrigger = RouterOutputs["automation"]["getTriggers"][number];

/**
 * What actually happened, newest first.
 *
 * The feed is derived from the fire ledger (`TriggerSent`), which is
 * DELIBERATELY metadata-only: it carries no trace ids and no trace content,
 * because fire history is gated by `triggers:view` — a weaker permission than
 * the trace-content protections. Nothing here may reference a trace.
 *
 * One ledger row can be two moments in time: a graph alert's row records both
 * when the alert opened (`createdAt`) and when it recovered (`resolvedAt`), so
 * a recovered alert contributes two entries to the timeline.
 */

type ActivityKind = "fired" | "alertOpened" | "alertRecovered" | "reportSent";

interface ActivityEntry {
  id: string;
  triggerId: string;
  name: string;
  kind: ActivityKind;
  at: Date;
}

const KIND_META: Record<
  ActivityKind,
  { label: string; icon: typeof Zap; palette: string }
> = {
  fired: { label: "Matched", icon: Zap, palette: "blue" },
  alertOpened: { label: "Started firing", icon: AlertTriangle, palette: "red" },
  alertRecovered: { label: "Recovered", icon: CheckCircle, palette: "green" },
  reportSent: { label: "Sent", icon: Calendar, palette: "purple" },
};

/** Local calendar day, so "Today" means the reader's today. */
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
  if (dayKeyOf(date) === dayKeyOf(today)) return "Today";
  if (dayKeyOf(date) === dayKeyOf(yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Flatten the ledger into timeline moments, newest first. */
export function toActivityEntries({
  fires,
  triggersById,
}: {
  fires: TriggerFire[];
  triggersById: Map<string, EnhancedTrigger>;
}): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const fire of fires) {
    const trigger = triggersById.get(fire.triggerId);
    // A fire whose automation has since been deleted still happened — say so
    // rather than dropping it, or the timeline would quietly rewrite history.
    const name = trigger?.name ?? "Deleted automation";
    const isAlert = fire.customGraphId !== null;
    const isReport = trigger?.triggerKind === "REPORT";

    entries.push({
      id: fire.id,
      triggerId: fire.triggerId,
      name,
      kind: isAlert ? "alertOpened" : isReport ? "reportSent" : "fired",
      at: new Date(fire.createdAt),
    });

    // Only a graph alert resolves. A trace row's `resolvedAt` is never set, and
    // a report's is stamped at write time purely so it can't read as an open
    // incident — neither is a "recovery" the reader should see.
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

export function AutomationsHistory({
  fires,
  triggers,
  isLoading,
  onOpenAutomation,
}: {
  fires: TriggerFire[];
  triggers: EnhancedTrigger[];
  isLoading: boolean;
  onOpenAutomation: (triggerId: string) => void;
}) {
  const triggersById = useMemo(
    () => new Map(triggers.map((t) => [t.id, t])),
    [triggers],
  );
  const days = useMemo(() => {
    const entries = toActivityEntries({ fires, triggersById });
    const grouped = new Map<string, ActivityEntry[]>();
    for (const entry of entries) {
      const key = dayKeyOf(entry.at);
      const bucket = grouped.get(key);
      if (bucket) bucket.push(entry);
      else grouped.set(key, [entry]);
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
          Nothing has fired yet. When your automations, alerts, and reports run,
          you'll see what they did here.
        </Text>
      </Box>
    );
  }

  return (
    <VStack align="stretch" gap={6}>
      {days.map((entries) => (
        <VStack align="stretch" gap={0} key={dayKeyOf(entries[0]!.at)}>
          <Text
            textStyle="xs"
            fontWeight="semibold"
            color="fg.muted"
            paddingBottom={2}
          >
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
  onOpen,
}: {
  entry: ActivityEntry;
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
      <Text
        textStyle="xs"
        color="fg.muted"
        flexShrink={0}
        title={entry.at.toLocaleString()}
      >
        {formatTimeAgo(entry.at.getTime())}
      </Text>
    </HStack>
  );
}
