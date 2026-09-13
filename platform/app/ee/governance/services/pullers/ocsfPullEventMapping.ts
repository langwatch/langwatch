// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One pulled provider event → one OCSF v1.1 audit row.
 *
 * Pure, and split out of the worker for that reason: this is the file where
 * "the audit trail names the wrong person" would happen, and the worker around
 * it is Prisma, ClickHouse and an outbox. Nothing here reads or writes.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import {
  type GovernanceOcsfEventInput,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "../governanceOcsfEvents.clickhouse.repository";
import { normalizeEmail } from "../logic/identityEvidence";
import { PULLED_USAGE_HINT_KEY } from "./pulledUsageRecord";
import type { NormalizedPullEvent } from "./pullerAdapter";

/**
 * The amount this event carries and the currency it is denominated in.
 *
 * The export is read by a customer's own SIEM, which takes the field names at
 * face value: `cost_usd` says dollars, so a euro amount placed there is read
 * as dollars and totalled with real ones. The pair below is the amount under a
 * name that admits its currency, at the top of the extension rather than
 * folded inside one adapter's hint bag — which is where the currency used to
 * be the only copy, reachable only by a reader who knew that adapter.
 *
 * The event's own fields win when it sets them. The hint is the fallback for
 * the adapters that carried the pair there before the port had a place for it,
 * so no adapter has to be rewritten for the export to stop lying.
 */
function ocsfMoneyFields(event: NormalizedPullEvent): {
  cost_amount?: string;
  cost_currency?: string;
} {
  const hint = event.extra?.[PULLED_USAGE_HINT_KEY] as
    | { costUsd?: unknown; currency?: unknown }
    | undefined;

  const amount =
    event.cost_amount ??
    (typeof hint?.costUsd === "string" ? hint.costUsd : undefined);
  const currency =
    event.cost_currency ??
    (typeof hint?.currency === "string" ? hint.currency : undefined);

  // Neither alone: an amount with no currency is the same guess this pair
  // exists to remove, and a currency with no amount denominates nothing.
  if (amount === undefined || currency === undefined) return {};
  return { cost_amount: amount, cost_currency: currency };
}

/**
 * Where one provider's actor string belongs among the OCSF actor fields.
 *
 * Adapters disagree about what they can name a person by, and the contract
 * says only "string": Copilot sends a user principal name, Claude an address,
 * the OpenAI cost report an opaque `user-…` id and no address at all, the
 * directory read a GUID. Writing all of them into `ActorEmail` made the
 * column's name a lie — an identifier sitting in an email-named field is not
 * evidence of an address, and the SIEM export ships that field to a customer's
 * own tooling, which reads it as one.
 *
 * So the string is placed by what it *is*: an address goes to `actorEmail`,
 * anything else to `actorUserId`, the field OCSF already reserves for the
 * provider's own identifier for the actor (`actor.user.uid`). Attribution is
 * unchanged — readers take the first of email / user id / enduser id that is
 * set — while the audit row stops claiming an address it never had.
 *
 * The address test is {@link normalizeEmail}, the same one the identity match
 * engine uses to decide what proves a link, so the two cannot drift into
 * disagreeing about what an address is. The value is stored verbatim rather
 * than normalized: this is an audit row, and it records what the provider
 * said, not a lowercased rewrite of it.
 */
export function ocsfActorFields(actor: string): {
  actorUserId: string;
  actorEmail: string;
} {
  if (normalizeEmail(actor) !== null) {
    return { actorUserId: "", actorEmail: actor };
  }
  return { actorUserId: actor, actorEmail: "" };
}

/**
 * Map a NormalizedPullEvent to a GovernanceOcsfEventInput row. Each
 * pull event becomes ONE OCSF row (ClassUid 6003 / API Activity, with
 * ActivityId INVOKE for completion-style events). The raw_payload is
 * preserved verbatim under metadata.extension.raw_event so SIEM
 * consumers can still drill back to the source-of-truth bytes.
 *
 * EventId includes the source id so two same-type sources cannot collide.
 *
 * `tenantId` MUST be the hidden internal_governance Project ID for the
 * org — same key the trace-fold subscriber and OCSF export service use.
 * Resolved by the worker before this is called.
 */
export function mapToOcsfRow({
  event,
  tenantId,
  ingestionSourceId,
  sourceType,
}: {
  event: NormalizedPullEvent;
  tenantId: string;
  ingestionSourceId: string;
  sourceType: string;
}): GovernanceOcsfEventInput {
  const eventTime = new Date(event.event_timestamp);
  const safeEventTime = Number.isFinite(eventTime.getTime())
    ? eventTime
    : new Date();
  const eventId = `${sourceType}:${ingestionSourceId}:${event.source_event_id}`;
  const occurredAtMs = safeEventTime.getTime();
  const { actorUserId, actorEmail } = ocsfActorFields(event.actor);
  const rawOcsfJson = JSON.stringify({
    class_uid: 6003,
    category_uid: 6,
    activity_id: OCSF_ACTIVITY.INVOKE,
    type_uid: 6003 * 100 + OCSF_ACTIVITY.INVOKE,
    severity_id: OCSF_SEVERITY.INFO,
    time: occurredAtMs,
    actor: {
      user: { uid: actorUserId, email_addr: actorEmail },
      enduser: { uid: "" },
    },
    api: { operation: event.action },
    dst_endpoint: { name: event.target },
    metadata: {
      product: { name: "LangWatch", vendor_name: "LangWatch" },
      extension: {
        // The adapter's own bag goes FIRST so the canonical fields below win a
        // name collision. `extra` is an open record — for the config-driven
        // adapters it is whatever key an administrator typed — and spread last
        // it could replace `cost_currency` while leaving `cost_amount`, which
        // exports a euro figure labelled as dollars. No shipped adapter names
        // one of these keys, so nothing here changes for them; what changes is
        // that a future one cannot.
        ...(event.extra ?? {}),
        uid: "langwatch.governance",
        source_type: sourceType,
        source_id: ingestionSourceId,
        ingest_mode: "pull",
        cost_usd: event.cost_usd,
        ...ocsfMoneyFields(event),
        tokens_input: event.tokens_input,
        tokens_output: event.tokens_output,
        raw_event: event.raw_payload,
      },
    },
  });
  return {
    tenantId,
    eventId,
    // Pull events are atomic — synthesize a stable trace id from the
    // event id so SIEM-side pivot ("show me this trace") still works.
    traceId: `pull:${eventId}`,
    sourceId: ingestionSourceId,
    sourceType,
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId: OCSF_SEVERITY.INFO,
    eventTime: safeEventTime,
    actorUserId,
    actorEmail,
    actorEnduserId: "",
    actionName: event.action,
    targetName: event.target,
    anomalyAlertId: "",
    rawOcsfJson,
  };
}
