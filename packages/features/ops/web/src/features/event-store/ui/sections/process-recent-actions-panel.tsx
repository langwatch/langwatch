import { ProcessRecentActions as ProcessRecentActionsView } from "../blocks/process-recent-actions.tsx";
import { api } from "../../../../behavior/ops-api.ts";

export function ProcessRecentActions() {
  const query = api.ops.listProcessActions.useQuery({ limit: 20 }, { refetchInterval: 30_000 });

  return (
    <ProcessRecentActionsView rows={query.data ?? []} now={query.dataUpdatedAt || Date.now()} />
  );
}
