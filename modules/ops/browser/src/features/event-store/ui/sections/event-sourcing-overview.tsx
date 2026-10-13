import { Link } from "@langwatch/browser-host/link";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { nowInstant } from "@langwatch/time";
import { ArrowRight, Skull } from "lucide-react";

import { api } from "../../../../behavior/ops-api.ts";
import { formatTimeAgo } from "../../../../model/ops-formatters.ts";
import { hasFleetTrouble } from "../../model/process-presentation.ts";
import { ProcessFleetStrip } from "../blocks/process-fleet-strip.tsx";
import { ProcessRecentActions } from "./processes-content.tsx";

/** Landing page: "is anything wrong, and where?" Headlines/pointers only. Subsystem
 * tables separate (space proportional to trouble, per ops-dashboard.md). */
export function EventSourcingOverview() {
  const fleet = api.ops.listProcessFleet.useQuery(undefined, {});
  const dead = api.ops.listDeadLetterCounts.useQuery(undefined, {});

  if (fleet.isPending) {
    return <SkeletonRows rows={6} />;
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
    <Banner
      status="error"
      icon={<Skull size={16} />}
      title={`${total} dead ${total === 1 ? "message" : "messages"}: this work will not run again until an operator redrives it`}
      action={
        <BannerAction asChild>
          <Link href="/ops/event-sourcing/dead-letters">
            View <ArrowRight size={12} />
          </Link>
        </BannerAction>
      }
    >
      Across{" "}
      {byProcess
        .slice(0, 3)
        .map((row) => `${row.processName} (${row.count})`)
        .join(", ")}
      {byProcess.length > 3 ? `, +${byProcess.length - 3} more` : ""} · oldest{" "}
      {formatTimeAgo(oldest, now)}
    </Banner>
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
    <Banner
      status="warning"
      title={`${troubledCount} of ${processCount} ${troubledCount === 1 ? "process is" : "processes are"} behind`}
      action={
        <BannerAction asChild>
          <Link href="/ops/event-sourcing/processes">
            Inspect <ArrowRight size={12} />
          </Link>
        </BannerAction>
      }
    >
      {troubledNames.slice(0, 4).join(", ")}
      {troubledNames.length > 4 ? `, +${troubledNames.length - 4} more` : ""}
    </Banner>
  );
}
