// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BuiltSubscriber } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import type { CanonicalSpan } from "~/server/event-sourcing/trace-processing/schema";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { GATEWAY_VIRTUAL_KEY_ID_ATTR } from "../projections/gatewayBudgetDebits.mapProjection";

const logger = createLogger(
  "langwatch:governance:virtual-key-last-used-subscriber",
);

/** Don't rewrite `lastUsedAt` more often than this — admin dashboards answer
 * "when did this user last use their key" on minute scale. */
export const VIRTUAL_KEY_LAST_USED_THROTTLE_MS = 60_000;

export interface VirtualKeyLastUsedSubscriberDeps {
  prisma: PrismaClient;
}

/**
 * ADR-075 Class C (retired; ground now ADR-098): touch `VirtualKey.lastUsedAt`
 * when a gateway span lands. Best-effort and at-most-once, never replayed —
 * unlike `gatewayBudgetDebits`, re-deriving this from history would stamp
 * `lastUsedAt = now()` on keys nobody has touched in weeks.
 */
async function touchIfSameTenant(
  deps: VirtualKeyLastUsedSubscriberDeps,
  args: {
    projectId: string;
    vk: { id: string; organizationId: string };
    now: Date;
  },
): Promise<void> {
  const { projectId, vk, now } = args;
  // Cross-tenant guard immediately before the write: `virtualKeyId` comes off
  // a span attribute the customer writes, so any tenant can name any VK id.
  const project = await deps.prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  if (!project || project.team.organizationId !== vk.organizationId) {
    logger.warn(
      { projectId, virtualKeyId: vk.id },
      "span references a cross-tenant virtual key — refusing to touch lastUsedAt",
    );
    return;
  }

  await deps.prisma.virtualKey.update({
    where: { id: vk.id },
    data: { lastUsedAt: now },
  });
}

export function createVirtualKeyLastUsedSubscriber(
  deps: VirtualKeyLastUsedSubscriberDeps,
): BuiltSubscriber {
  return {
    name: "virtualKeyLastUsed",
    eventTypes: ["lw.obs.trace.span_received"],
    async handle(event, ctx) {
      const projectId = ctx.tenantId;
      const span = event.data as CanonicalSpan;

      try {
        const virtualKeyId = span.attributes[GATEWAY_VIRTUAL_KEY_ID_ATTR];
        if (typeof virtualKeyId !== "string" || virtualKeyId === "") return;

        const vk = await deps.prisma.virtualKey.findUnique({
          where: { id: virtualKeyId },
          select: { id: true, lastUsedAt: true, organizationId: true },
        });
        if (!vk) return;

        const now = new Date();
        const isStale =
          !vk.lastUsedAt ||
          now.getTime() - vk.lastUsedAt.getTime() >
            VIRTUAL_KEY_LAST_USED_THROTTLE_MS;
        if (!isStale) return;

        await touchIfSameTenant(deps, { projectId, vk, now });
      } catch (error) {
        // At-most-once by design: never throw back into the queue.
        logger.warn(
          { projectId, error },
          "failed to touch virtualKey.lastUsedAt — non-fatal",
        );
        captureException(toError(error));
      }
    },
  };
}
