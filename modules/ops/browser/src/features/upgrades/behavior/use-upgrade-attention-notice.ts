/**
 * Whether the shell tells every signed-in user the last upgrade needs attention. False until it
 * answers and on any error, so loading never flashes. Spec: modules/ops/specs/upgrades.feature
 */
import { api } from "../../../behavior/ops-api.ts";

/** Members get no read hints, so the notice re-reads on this slow timer. */
const ATTENTION_NOTICE_REFRESH_MS = 5 * 60 * 1000;

export function useUpgradeAttentionNotice(): boolean {
  const notice = api.ops.upgrade.attentionNotice.useQuery(undefined, {
    refetchInterval: ATTENTION_NOTICE_REFRESH_MS,
  });
  return notice.data?.show === true;
}
