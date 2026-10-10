import { api } from "../../../behavior/ops-api.ts";

export function useReplayStatus() {
  // needs a read hint: replay progressed or finished
  return api.ops.getReplayStatus.useQuery(undefined);
}
