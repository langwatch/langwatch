import {
  Box,
  Button,
  Card,
  Center,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowRight, Skull } from "lucide-react";
import { ProcessFleetStrip } from "~/components/ops/processes/ProcessFleetStrip";
import { ProcessRecentActions } from "~/components/ops/processes/ProcessRecentActions";
import { hasFleetTrouble } from "~/components/ops/processes/processFleet";
import { formatTimeAgo } from "@langwatch/ops-web";
import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";

/**
 * Where an operator lands, built to answer one question: is anything wrong,
 * and where.
 *
 * Everything here is a headline or a pointer. The subsystem tables live on
 * their own routes, because ops-dashboard.md's rule is that space is
 * proportional to trouble and four dense tables stacked on one page give the
 * healthy three exactly as much room as the broken one.
 */
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
  const now = fleet.dataUpdatedAt || Date.now();

  return (
    <VStack align="stretch" gap={4}>
      {deadTotal > 0 && (
        <DeadLetterBanner
          total={deadTotal}
          byProcess={deadByProcess}
          now={now}
        />
      )}

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

/**
 * Dead work, first thing, in red, with a way in.
 *
 * A dead message is the only state this substrate reports that will never
 * resolve on its own. It was previously a number in a table cell with nothing
 * behind it — an alarm with the label torn off, in the words of the ops
 * guidance. It now leads the page and links to the rows themselves.
 */
function DeadLetterBanner({
  total,
  byProcess,
  now,
}: {
  total: number;
  byProcess: Array<{
    processName: string;
    count: number;
    oldestUpdatedAt: number;
  }>;
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
              {total} dead {total === 1 ? "message" : "messages"} — this work
              will not run again until an operator redrives it
            </Text>
            <Text textStyle="xs" color="fg.muted" marginTop={1}>
              Across{" "}
              {byProcess
                .slice(0, 3)
                .map((row) => `${row.processName} (${row.count})`)
                .join(", ")}
              {byProcess.length > 3 ? `, +${byProcess.length - 3} more` : ""} ·
              oldest {formatTimeAgo(oldest, now)}
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
        All {processCount} processes are keeping up — no overdue wakes, lapsed
        leases, or backed-up pending messages.
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
              {troubledNames.length > 4
                ? `, +${troubledNames.length - 4} more`
                : ""}
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
