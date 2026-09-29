import type {
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

/** A governance envelope: every data field is a string or null, as main's were. */
export const governanceEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.literal("1"),
  data: z.record(z.string(), z.string().nullable()),
});
export type GovernanceEnvelope = z.infer<typeof governanceEnvelopeSchema>;

function isoMillis(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toString({ fractionalSecondDigits: 3 });
}

/** `gateway.virtual_key.<action>`, its id the (key, action, instant) main keyed it by. */
export function virtualKeyLifecycleEnvelope(
  data: RecordVkLifecycleCommandData,
): GovernanceEnvelope {
  const type = `gateway.virtual_key.${data.action}`;
  const id = `${data.virtual_key_id}:${data.action}:${data.occurred_at}`;
  return {
    id,
    type,
    created: isoMillis(data.occurred_at),
    schema_version: "1",
    data: {
      event_id: id,
      event_type: type,
      organization_id: data.organization_id,
      virtual_key_id: data.virtual_key_id,
      name: data.name,
      display_prefix: data.display_prefix,
      reason: data.reason,
      occurred_at: isoMillis(data.occurred_at),
    },
  };
}

/** `gateway.budget.threshold_crossed|breached`, its id the once-per-period crossing key. */
export function budgetCrossingEnvelope(data: RecordBudgetCrossingCommandData): GovernanceEnvelope {
  const type =
    data.kind === "breached" ? "gateway.budget.breached" : "gateway.budget.threshold_crossed";
  const id = `${data.budget_id}:${data.bucket_scope_id}:${data.kind}:${data.period_started_at_ms}`;
  return {
    id,
    type,
    created: isoMillis(data.occurred_at),
    schema_version: "1",
    data: {
      event_id: id,
      event_type: type,
      organization_id: data.organization_id,
      budget_id: data.budget_id,
      scope_type: data.scope_type.toLowerCase(),
      bucket_scope_id: data.bucket_scope_id,
      virtual_key_id: data.virtual_key_id,
      anchor_project_id: data.anchor_project_id,
      end_user_id: data.end_user_id,
      window: data.window.toLowerCase(),
      period_started_at: isoMillis(data.period_started_at_ms),
      limit_usd: data.limit_usd,
      spent_usd: data.spent_usd,
      on_breach: data.on_breach.toLowerCase(),
      occurred_at: isoMillis(data.occurred_at),
    },
  };
}
