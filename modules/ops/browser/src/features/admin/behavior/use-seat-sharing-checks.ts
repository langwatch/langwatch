import { api } from "../../../behavior/ops-api.ts";

/** The last seat sharing check, empty before the first; asked only where Cloud admin is on. */
export function useSeatSharingChecks({ enabled }: { enabled: boolean }) {
  return api.ops.findSeatSharingChecks.useQuery(undefined, { enabled });
}
