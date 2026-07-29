// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { spanNormalizationPipelineService } from "@ee/governance/services/spanDerivation.composition";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type {
  SpanReceivedEvent,
  TraceProcessingEvent,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  GATEWAY_VIRTUAL_KEY_ID_ATTR,
  spanCarriesGatewayVirtualKeyId,
} from "../projections/gatewayBudgetDebits.mapProjection";

const logger = createLogger(
  "langwatch:governance:virtual-key-last-used-subscriber",
);

/**
 * Don't rewrite `lastUsedAt` more often than this. Admin dashboards answer
 * "when did this user last use their key" on minute scale; the row does not
 * need to move on every request. Carried over verbatim from the reactor's EC6
 * touch, which mirrored the same throttle in `/budget/check`.
 */
export const VIRTUAL_KEY_LAST_USED_THROTTLE_MS = 60_000;

export interface VirtualKeyLastUsedSubscriberDeps {
  prisma: PrismaClient;
}

/**
 * Total, non-throwing enqueue predicate: does this raw span carry a virtual
 * key marker?
 *
 * ADR-069 gives the enqueue seam no retry, so a throw here permanently loses
 * the job rather than reading as "not relevant" — which is why the scan it
 * delegates to reads the RAW OTLP attribute list with array guards and
 * equality checks only, no decoding and no normalization.
 *
 * Without it every span in the product mints a job for a write that concerns
 * only gateway traffic. With it, an irrelevant event costs nothing.
 *
 * The scan itself is `spanCarriesGatewayVirtualKeyId`, shared verbatim with
 * the `gatewayBudgetDebits` projection, which applies it for the same reason
 * one level along: neither half of this split can decide a span is worth
 * normalising when the other would not. What they do AFTER normalising
 * differs on purpose — see `deriveGatewayDebitRecord`'s docstring.
 */
export function spanCarriesVirtualKeyMarker(
  event: TraceProcessingEvent,
): boolean {
  if (event.type !== SPAN_RECEIVED_EVENT_TYPE) return false;
  return spanCarriesGatewayVirtualKeyId(
    (event as SpanReceivedEvent).data?.span,
  );
}

/**
 * ADR-075 Class C (the split half): touch `VirtualKey.lastUsedAt` when a
 * gateway span lands.
 *
 * The reactor this comes from did two unrelated things. Writing the budget
 * ledger is derived state and became the `gatewayBudgetDebits` map projection,
 * so replay rebuilds it. This is not derived state — it is a best-effort
 * mutation of an operational Postgres column, and the reactor's own comment
 * said so ("Best-effort: a row update failure here doesn't poison the budget
 * fold below"). Replaying it would be actively wrong: re-deriving a month of
 * traces would stamp `lastUsedAt = now()` on keys nobody has touched in weeks,
 * turning "when was this key last used" into "when did an operator last run a
 * replay". So it is a subscriber, at-most-once, never replayed.
 *
 * Why it exists at all: `/budget/check` only fires when the gateway calls it,
 * which it skips when a key has no budgets to precheck — so keys without
 * budgets had `lastUsedAt = null` forever and admin oversight was broken on the
 * most common case.
 */
export function createVirtualKeyLastUsedSubscriber(
  deps: VirtualKeyLastUsedSubscriberDeps,
): EventSubscriberDefinition<TraceProcessingEvent> {
  return {
    name: "virtualKeyLastUsed",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    options: {
      enqueue: { filter: spanCarriesVirtualKeyMarker },
    },

    async handle(event, context): Promise<void> {
      const projectId = context.tenantId;

      try {
        // A rolling deploy can still deliver jobs staged by a build without the
        // filter, so the handler re-establishes the gate on its own terms.
        if (event.type !== SPAN_RECEIVED_EVENT_TYPE) return;
        const span = spanNormalizationPipelineService.normalizeSpanReceived(
          event.tenantId,
          (event as SpanReceivedEvent).data.span,
          (event as SpanReceivedEvent).data.resource,
          (event as SpanReceivedEvent).data.instrumentationScope,
        );
        const virtualKeyId = span.spanAttributes[GATEWAY_VIRTUAL_KEY_ID_ATTR];
        if (typeof virtualKeyId !== "string" || virtualKeyId === "") return;

        const vk = await deps.prisma.virtualKey.findUnique({
          where: { id: virtualKeyId },
          select: { id: true, lastUsedAt: true, organizationId: true },
        });
        if (!vk) return;

        // Throttle first. The staleness check needs nothing the row above did
        // not already carry, and it discards the vast majority of gateway
        // spans — resolving the project's org for a span that is about to
        // write nothing is a Postgres read per gateway request bought for
        // nothing.
        const now = new Date();
        const isStale =
          !vk.lastUsedAt ||
          now.getTime() - vk.lastUsedAt.getTime() >
            VIRTUAL_KEY_LAST_USED_THROTTLE_MS;
        if (!isStale) return;

        // Cross-tenant guard, immediately before the write it guards.
        // `virtualKeyId` comes off a span attribute the customer writes, and it
        // is not in the reserved namespace the receiver strips — so any tenant
        // can name any VK id here. The multitenancy middleware does NOT catch
        // it: VirtualKey's validateWhere accepts a bare row id as tenancy proof
        // for single-row writes.
        //
        // The debit half of this split carries the same check
        // (gatewayBudgetDebits.store.ts). Splitting the touch out into its own
        // subscriber removed the only path that resolved project -> org, so
        // without this the guard is structurally absent rather than merely
        // late, and a forged span blind-writes another org's row.
        //
        // Sitting behind the throttle costs nothing in enforcement — every
        // write still passes it — but it does mean the warning below is
        // sampled at the throttle interval rather than logged per forged span,
        // because a forged span aimed at an actively-used key is discarded as
        // fresh before the org is ever resolved.
        const project = await deps.prisma.project.findUnique({
          where: { id: projectId },
          select: { team: { select: { organizationId: true } } },
        });
        if (!project || project.team.organizationId !== vk.organizationId) {
          logger.warn(
            { projectId, virtualKeyId },
            "span references a cross-tenant virtual key — refusing to touch lastUsedAt",
          );
          return;
        }

        // Post-collapse VirtualKey is org-scoped in SCOPED_MODELS; the dbMTP
        // guard accepts a row id as tenancy proof for single-row writes, so the
        // bare id-only where clause is valid.
        await deps.prisma.virtualKey.update({
          where: { id: vk.id },
          data: { lastUsedAt: now },
        });
      } catch (error) {
        // At-most-once by design: never throw back into the queue. A missed
        // touch costs a stale "last used" reading that the next gateway request
        // corrects; retrying it buys nothing and a wedged group would stall a
        // lane that carries nothing else worth retrying.
        logger.warn(
          { projectId, error },
          "failed to touch virtualKey.lastUsedAt — non-fatal",
        );
        captureException(toError(error));
      }
    },
  };
}
