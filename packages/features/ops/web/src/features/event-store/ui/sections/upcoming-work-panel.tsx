import { api } from "../../../../behavior/ops-api";
import { UpcomingWorkCard as UpcomingWorkCardView } from "../elements/upcoming-work-card";

/** App transport adapter for the controlled upcoming-work presentation. */
export function UpcomingWorkCard() {
  const schedulesQuery = api.ops.listScheduledJobs.useQuery(
    { limit: 50 },
    { refetchInterval: 30_000 },
  );
  const wakesQuery = api.ops.listUpcomingWakes.useQuery({ limit: 50 }, { refetchInterval: 30_000 });
  const now = Math.max(schedulesQuery.dataUpdatedAt, wakesQuery.dataUpdatedAt) || Date.now();

  return (
    <UpcomingWorkCardView
      schedules={schedulesQuery.data ?? []}
      wakes={wakesQuery.data ?? []}
      now={now}
    />
  );
}
