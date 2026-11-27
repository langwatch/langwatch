import { PII_REDACTION_REQUEST_TYPE } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import type {
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GatewaySpendEvent,
} from "@langwatch/gateway-contract";
import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-judge-contract";
import { Temporal } from "@langwatch/time";

import { billingMonthOf } from "./billing-month.rules.ts";

/** The request types whose confirmed spend a Stripe meter bills (ADR-174 decision 20). */
const METERED_SPEND_REQUEST_TYPES: ReadonlySet<string> = new Set([
  INSTANT_EVAL_REQUEST_TYPE,
  PII_REDACTION_REQUEST_TYPE,
]);

/** The fields of gateway's confirmed spend the month's report is dispatched from. */
export type ConfirmedSpend = Pick<
  Extract<GatewaySpendEvent, { type: typeof GATEWAY_SPEND_CONFIRMED_EVENT_TYPE }>["data"],
  "organization_id" | "request_type" | "occurred_at"
>;

/** Whether a confirmed spend is billed by a meter and names the organization it bills. */
export function isMeteredSpend({ spend }: { spend: ConfirmedSpend }): boolean {
  return spend.organization_id !== "" && METERED_SPEND_REQUEST_TYPES.has(spend.request_type);
}

/**
 * The report a metered spend dispatches: its organization and the UTC month it occurred in,
 * with no events total and no counted event, so the events meter keeps its own cursor.
 */
export function spendReportOf({
  spend,
}: {
  spend: ConfirmedSpend;
}): ReportUsageForMonthCommandData {
  return {
    organizationId: spend.organization_id,
    billingMonth: billingMonthOf({
      now: Temporal.Instant.fromEpochMilliseconds(spend.occurred_at),
    }),
    tenantId: spend.organization_id,
    occurredAt: spend.occurred_at,
    trigger: "spend_confirmed",
  };
}
