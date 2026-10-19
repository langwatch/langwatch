import { nowInstant } from "@langwatch/time";

import { api } from "../../../../behavior/ops-api.ts";
import { InsightSchedulesContentView } from "./insight-schedules-content.tsx";

/** App transport adapter for the controlled daily insights schedules presentation. */
export function InsightSchedulesContent() {
  const query = api.ops.listInsightSchedules.useQuery({ limit: 200 }, {});

  return (
    <InsightSchedulesContentView
      schedules={query.data ?? []}
      isLoading={query.isLoading}
      now={query.dataUpdatedAt || nowInstant().epochMilliseconds}
    />
  );
}
