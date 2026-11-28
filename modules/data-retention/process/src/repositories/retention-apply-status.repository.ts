import type { StateProjectionStore } from "@langwatch/eventing";

import type { RetentionApplyStatusState } from "../eventing/retention-apply-status.projection.ts";
import type { ScopeApplyRecord } from "../rules/stored-apply-status.rules.ts";

/** The status projection's rows: written by the fold, read by the settings snapshot. */
export interface RetentionApplyStatusRepository extends StateProjectionStore<RetentionApplyStatusState> {
  findForOrganization(input: { organizationId: string }): Promise<ScopeApplyRecord[]>;
}
