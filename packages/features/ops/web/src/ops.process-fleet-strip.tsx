import { HStack } from "@chakra-ui/react";
import type { ProcessFleetSummary } from "@langwatch/ops-contract";
import { formatCount } from "./formatters";
import { LinkedStat } from "./ops.dashboard-linked-stat";

/** The fleet's headline numbers, one row, trouble colored. */
export function ProcessFleetStrip({ rows }: { rows: ProcessFleetSummary[] }) {
  const sum = (pick: (r: ProcessFleetSummary) => number) =>
    rows.reduce((acc, r) => acc + pick(r), 0);
  const instances = sum((r) => r.instances);
  const overdueWakes = sum((r) => r.overdueWakes);
  const pending = sum((r) => r.pendingMessages);
  const lapsed = sum((r) => r.lapsedLeases);
  const dead = sum((r) => r.deadMessages);

  return (
    <HStack gap={1} align="stretch" overflowX="auto">
      <LinkedStat
        label="Processes"
        value={formatCount(rows.length)}
        sublabel={`${formatCount(instances)} instances`}
      />
      <LinkedStat
        label="Overdue wakes"
        value={formatCount(overdueWakes)}
        color={overdueWakes > 0 ? "orange.500" : undefined}
      />
      <LinkedStat label="Pending messages" value={formatCount(pending)} />
      <LinkedStat
        label="Lapsed leases"
        value={formatCount(lapsed)}
        sublabel={lapsed > 0 ? "died or still delivering" : undefined}
        color={lapsed > 0 ? "orange.500" : undefined}
      />
      <LinkedStat
        label="Dead messages"
        value={formatCount(dead)}
        sublabel={dead > 0 ? "will not run until redriven" : undefined}
        color={dead > 0 ? "red.500" : undefined}
      />
    </HStack>
  );
}
