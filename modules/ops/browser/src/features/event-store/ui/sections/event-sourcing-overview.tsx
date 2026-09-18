import { Box, Button, Card, Center, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { nowInstant } from "@langwatch/time";
import { ArrowRight, Skull } from "lucide-react";

import { api } from "../../../../behavior/ops-api.ts";
import { formatTimeAgo } from "../../../../model/ops-formatters.ts";
import { Link } from "../../../../ui/elements/ops-link.tsx";
import { hasFleetTrouble } from "../../model/process-presentation.ts";
import { ProcessFleetStrip } from "../blocks/process-fleet-strip.tsx";
import { ProcessRecentActions } from "./process-recent-actions-panel.tsx";

/** Landing page: "is anything wrong, and where?" Headlines/pointers only. Subsystem
 * tables separate (space proportional to trouble, per ops-dashboard.md). */
export function EventSourcingOverview() {
  const fleet = api.ops.listProcessFleet.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const dead = api.ops.listDeadLetterCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (fleet.isPending) {
    return (
      <Center paddingY={20}>
        <Spinner size="lg" />
      </Center>
    );
  }

  const rows = fleet.data ?? [];
  const deadByProcess = dead.data ?? [];
  const deadTotal = deadByProcess.reduce((sum, row) => sum + row.count, 0);
  const troubled = rows.filter(hasFleetTrouble);
  const now = fleet.dataUpdatedAt || nowInstant().epochMilliseconds;

  return (
    <VStack align="stretch" gap={4}>
      {deadTotal > 0 && <DeadLetterBanner total={deadTotal} byProcess={deadByProcess} now={now} />}

      <ProcessFleetStrip rows={rows} />

      <HealthLine
        troubledCount={troubled.length}
        processCount={rows.length}
        troubledNames={troubled.map((row) => row.processName)}
      />

      <ProcessRecentActions />
    </VStack>
  );
}

/** Dead work first, red, with way in (was just alarm-number in cell). Never
 * resolves on its own. */
function DeadLetterBanner({
  total,
  byProcess,
  now,
}: {
  total: number;
  byProcess: {
    processName: string;
    count: number;
    oldestUpdatedAt: number;
  }[];
  now: number;
}) {
  const oldest = Math.min(...byProcess.map((row) => row.oldestUpdatedAt));
  return (
    <Card.Root borderColor="red.500" borderWidth="1px">
      <Card.Body padding={4}>
        <HStack align="start" gap={3}>
          <Box color="red.500" paddingTop={0.5}>
            <Skull size={18} />
          </Box>
          <Box flex={1}>
            <Text textStyle="sm" fontWeight="medium">
              {total} dead {total === 1 ? "message" : "messages"}: this work will not run again
              until an operator redrives it
            </Text>
            <Text textStyle="xs" color="fg.muted" marginTop={1}>
              Across{" "}
              {byProcess
                .slice(0, 3)
                .map((row) => `${row.processName} (${row.count})`)
                .join(", ")}
              {byProcess.length > 3 ? `, +${byProcess.length - 3} more` : ""} · oldest{" "}
              {formatTimeAgo(oldest, now)}
            </Text>
          </Box>
          <Button size="xs" variant="outline" asChild>
            <Link href="/ops/event-sourcing/dead-letters">
              View <ArrowRight size={12} />
            </Link>
          </Button>
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * One line when clear, and it names what is wrong when it is not. An
 * all-clear that takes a full card costs a third of a viewport to say nothing.
 */
function HealthLine({
  troubledCount,
  processCount,
  troubledNames,
}: {
  troubledCount: number;
  processCount: number;
  troubledNames: string[];
}) {
  if (troubledCount === 0) {
    return (
      <Text textStyle="xs" color="fg.muted">
        All {processCount} processes are keeping up: no overdue wakes, lapsed leases, or backed-up
        pending messages.
      </Text>
    );
  }
  return (
    <Card.Root borderColor="orange.500" borderWidth="1px">
      <Card.Body padding={4}>
        <HStack justify="space-between">
          <Box>
            <Text textStyle="sm" fontWeight="medium">
              {troubledCount} of {processCount}{" "}
              {troubledCount === 1 ? "process is" : "processes are"} behind
            </Text>
            <Text textStyle="xs" color="fg.muted" marginTop={1}>
              {troubledNames.slice(0, 4).join(", ")}
              {troubledNames.length > 4 ? `, +${troubledNames.length - 4} more` : ""}
            </Text>
          </Box>
          <Button size="xs" variant="outline" asChild>
            <Link href="/ops/event-sourcing/processes">
              Inspect <ArrowRight size={12} />
            </Link>
          </Button>
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}
