import { api } from "../../../behavior/ops-api";

export function useReplayStatus({
  refetchInterval = 2000,
}: {
  refetchInterval?: number | false;
} = {}) {
  return api.ops.getReplayStatus.useQuery(undefined, { refetchInterval });
}
