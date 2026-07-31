import {
  assertWebhookEndpointsEntitled,
  WebhookEndpointsNotEntitledError,
} from "@ee/webhooks/entitlement";
import { spendRowToEnvelope } from "@ee/webhooks/envelope";
import type { Organization } from "@prisma/client";
import type { Context, Next } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  decodeSpendEventsCursor,
  GatewaySpendEventsRepository,
} from "~/server/gateway/spendEvents.clickhouse.repository";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { BadRequestError, ForbiddenError } from "../../shared/errors";
import {
  END_USER_SPEND_DESCRIPTION,
  SPEND_EVENTS_PULL_DESCRIPTION,
} from "./contract";
import { handleGatewaySpendApiError } from "./error-handler";

patchZodOpenapi();

const spendEvents = new GatewaySpendEventsRepository(async (tenantId) => {
  const client = await getClickHouseClientForProject(tenantId);
  if (!client) throw new Error("ClickHouse is not configured");
  return client;
});

/**
 * The billing reconciliation surface rides the webhook platform's plan flag
 * (ADR-072: "the spend-events pull API gates under the same flag"): pull and
 * push are two views of one enterprise capability.
 */
async function requireBillingPlan(c: Context, next: Next): Promise<void> {
  const organization = c.get("organization") as Organization;
  try {
    await assertWebhookEndpointsEntitled(organization.id);
  } catch (error) {
    if (error instanceof WebhookEndpointsNotEntitledError) {
      throw new ForbiddenError(
        "The billing events API is an enterprise feature; this organization's plan does not include it.",
      );
    }
    throw error;
  }
  await next();
}

const spendEventsQuerySchema = z
  .object({
    // The reconciliation pull is a RANGED read by contract: without bounds
    // the walk sorts the whole 13-month table under FINAL on every page.
    from: z.coerce.number().int().positive().safe(),
    to: z.coerce.number().int().positive().safe(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().positive().max(200).optional().default(50),
    virtual_key_id: z.string().min(1).max(100).optional(),
    end_user_id: z.string().min(1).max(256).optional(),
    project_id: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(200).optional(),
    status: z
      .enum(["success", "error", "admitted", "confirmed", "failed", "settled"])
      .optional(),
  })
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

const END_USER_WINDOWS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
} as const;

const endUserSpendQuerySchema = z.object({
  window: z.enum(["day", "week", "month"]).optional().default("month"),
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
  virtual_key_id: z.string().min(1).max(100).optional(),
});

/** The org's project ids, optionally narrowed to one the caller asked for. */
async function orgTenantIds(
  organizationId: string,
  projectId?: string,
): Promise<string[]> {
  // Ordered so downstream client routing by the first tenant is stable.
  const projects = await prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const ids = projects.map((p) => p.id);
  if (projectId !== undefined) {
    return ids.includes(projectId) ? [projectId] : [];
  }
  return ids;
}

const secured = createOrgApp({ basePath: "/api/gateway/v1" });

secured.hono.onError(handleGatewaySpendApiError);

const spendSummariesQuerySchema = z.object({
  group_by: z.enum(["virtual_key", "end_user"]),
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
  project_id: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional().default(500),
});

secured.access(requires("gatewaySpend:view")).get(
  "/spend-summaries",
  requireBillingPlan,
  describeRoute({
    description:
      "Reconciliation checksum fast path: per-key spend rollups grouped by virtual key or end user, with token classes and integer nano-USD cost. Settled (unpriced) requests are counted separately as settled_count and never included in cost sums. Diff individual items via /spend-events only when a checksum diverges.",
  }),
  zValidator("query", spendSummariesQuerySchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const query = c.req.valid("query");
    const tenantIds = await orgTenantIds(organization.id, query.project_id);
    const rows = await spendEvents.readSpendSummaries({
      tenantIds,
      groupBy: query.group_by,
      fromMs: query.from,
      toMs: query.to,
      limit: query.limit,
    });
    return c.json({
      data: rows.map((r) => ({
        key: r.key,
        event_count: r.eventCount,
        settled_count: r.settledCount,
        usage: {
          input_tokens: r.tokensInput,
          output_tokens: r.tokensOutput,
          cache_read_input_tokens: r.tokensCacheRead,
          cache_creation_input_tokens: r.tokensCacheWrite,
          reasoning_tokens: r.tokensReasoning,
        },
        cost: { total_usd: r.costUsd, nano_usd: r.costNanoUsd },
      })),
    });
  },
);

secured
  .access(requires("gatewaySpend:view"))
  .get(
    "/spend-events",
    requireBillingPlan,
    describeRoute({ description: SPEND_EVENTS_PULL_DESCRIPTION }),
    zValidator("query", spendEventsQuerySchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const query = c.req.valid("query");
      // A present-but-garbled cursor is a caller bug: refusing beats
      // silently restarting the walk, which would re-serve the whole range.
      if (
        query.cursor !== undefined &&
        !decodeSpendEventsCursor(query.cursor)
      ) {
        throw new BadRequestError("Invalid cursor.");
      }
      const tenantIds = await orgTenantIds(organization.id, query.project_id);
      const page = await spendEvents.walkSpendEvents({
        tenantIds,
        fromMs: query.from,
        toMs: query.to,
        cursor: query.cursor ?? null,
        limit: query.limit,
        virtualKeyId: query.virtual_key_id,
        endUserId: query.end_user_id,
        model: query.model,
        status: query.status,
      });
      return c.json({
        data: page.rows.map(spendRowToEnvelope),
        next_cursor: page.nextCursor,
      });
    },
  );

secured
  .access(requires("gatewaySpend:view"))
  .get(
    "/end-users/:id/spend",
    requireBillingPlan,
    describeRoute({ description: END_USER_SPEND_DESCRIPTION }),
    zValidator("query", endUserSpendQuerySchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const endUserId = c.req.param("id");
      const query = c.req.valid("query");
      const now = Date.now();
      const fromMs = query.from ?? now - END_USER_WINDOWS[query.window];
      const toMs = query.to ?? now;
      const tenantIds = await orgTenantIds(organization.id);
      const rollup = await spendEvents.readEndUserSpend({
        tenantIds,
        endUserId,
        fromMs,
        toMs,
        virtualKeyId: query.virtual_key_id,
      });
      return c.json({
        data: {
          end_user_id: endUserId,
          window: query.window,
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
          cost: { total_usd: rollup.spendUsd, nano_usd: rollup.spendNanoUsd },
          request_count: rollup.requestCount,
          usage: {
            input_tokens: rollup.tokensInput,
            output_tokens: rollup.tokensOutput,
            cache_read_input_tokens: rollup.tokensCacheRead,
            cache_creation_input_tokens: rollup.tokensCacheWrite,
            reasoning_tokens: rollup.tokensReasoning,
          },
          cap: null,
        },
      });
    },
  );

export const app = secured.hono;
