import { api } from "../../../behavior/ops-api.ts";

/** The last seat sharing check, empty before the first; the Cloud admin screen gates it. */
export function useSeatSharingChecks() {
  return api.ops.findSeatSharingChecks.useQuery(undefined);
}
