import type { DashboardData } from "@langwatch/ops-contract";
import { ParkedGroupsView } from "../blocks/parked-groups-view.tsx";
import { PausedCard as PausedCardView } from "./paused-card.tsx";
import { Link } from "../../../../ui/elements/ops-link.tsx";
import { usePausedSchedules } from "../../behavior/use-paused-schedules.ts";
import { api } from "../../../../behavior/ops-api.ts";

export function PausedCard({
  parkedTenants,
  parkedTenantsBound,
  pausedKeys,
}: Pick<DashboardData, "parkedTenants" | "parkedTenantsBound" | "pausedKeys">) {
  const schedules = usePausedSchedules();

  return (
    <PausedCardView
      parkedTenants={parkedTenants}
      parkedTenantsBound={parkedTenantsBound}
      pausedKeys={pausedKeys}
      schedules={schedules.schedules}
      schedulesTotal={schedules.total}
      renderParkedGroups={({ queueName, tenantId }) => (
        <ParkedGroupList queueName={queueName} tenantId={tenantId} />
      )}
      renderSchedulesLink={(href) => (
        <Link href={href} fontSize="xs" color="fg.muted">
          Schedules
        </Link>
      )}
      renderSubscribersLink={(href) => (
        <Link href={href} fontSize="xs" color="fg.muted">
          Subscribers
        </Link>
      )}
    />
  );
}

function ParkedGroupList({ queueName, tenantId }: { queueName: string; tenantId: string }) {
  const query = api.ops.listParkedGroups.useQuery(
    { queueName, tenantId, page: 1, pageSize: 20 },
    { refetchInterval: 10_000 },
  );

  return (
    <ParkedGroupsView
      isLoading={query.isLoading}
      isError={query.isError}
      groups={query.data?.groups ?? []}
      total={query.data?.total ?? 0}
    />
  );
}
