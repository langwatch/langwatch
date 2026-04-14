import { api } from "~/utils/api";

export function useReplayStatus({
  refetchInterval = 2000,
}: { refetchInterval?: number | false } = {}) {
  return api.ops.getReplayStatus.useQuery(undefined, { refetchInterval });
}
