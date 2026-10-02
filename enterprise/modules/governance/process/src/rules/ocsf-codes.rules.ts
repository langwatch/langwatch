// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * OCSF v1.1 SeverityId: 1 informational, 3 low, 4 medium, 5 high, 6 critical.
 * Default 1; elevated when `langwatch.governance.anomaly_alert_id` is set.
 */
export const OCSF_SEVERITY = {
  INFO: 1,
  LOW: 3,
  MEDIUM: 4,
  HIGH: 5,
  CRITICAL: 6,
} as const;

/**
 * OCSF v1.1 ActivityId for ClassUid 6003 (API Activity): 1 create, 2 read,
 * 3 update, 4 delete, 6 invoke (an LLM call or agent action).
 */
export const OCSF_ACTIVITY = {
  CREATE: 1,
  READ: 2,
  UPDATE: 3,
  DELETE: 4,
  INVOKE: 6,
} as const;
