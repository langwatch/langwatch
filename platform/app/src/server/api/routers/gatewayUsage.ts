/**
 * tRPC router for /gateway/usage. Read-only — historical spend from the
 * ClickHouse `trace_summaries` cost path, the same source the keys table's
 * "Spent this month" column reads, grouped by key / model / day.
 *
 * Org-scoped, like the virtual-keys router: usage reads span every project
 * of the organization because traces land in a key's trace destination,
 * not in whichever project the viewer has selected. Visibility follows the
 * same membership rule as the keys table, so the page and the table agree
 * on which keys exist and what they spent.
 */

import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";

import type { App } from "~/server/app-layer/app";
import { VirtualKeyNotFoundError } from "@langwatch/gateway-server";
import { GatewayUsageService } from "@langwatch/gateway-server";
import { isVisibleToMembership, loadMembershipSet } from "~/server/gateway/virtualKey.authz";

import { authorizeInResolver } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

function usageService(prisma: PrismaClient, gateway: App["gateway"]) {
  return GatewayUsageService.create({
    prisma,
    chRepo: gateway.budgets,
    spendRepo: gateway.virtualKeySpend,
  });
}

export const gatewayUsageRouter = createTRPCRouter({
  // Membership-based like virtualKeys.list: the summary totals the keys
  // the caller can see, so its numbers reconcile with the table a click
  // arrives from. A non-member sees no keys and gets an empty summary.
  summary: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        fromDate: z.string().datetime(),
        toDate: z.string().datetime(),
      }),
    )
    .use(
      authorizeInResolver({
        organizationId:
          "loadMembershipSet + isVisibleToMembership: usage is summed only over keys visible to the caller's membership in this organization",
      }),
    )
    .query(async ({ ctx, input }) => {
      const membership = await loadMembershipSet(
        ctx.prisma,
        input.organizationId,
        ctx.session.user.id,
      );
      const keys = (await ctx.app.gateway.virtualKeys.getAll(input.organizationId)).filter((vk) =>
        isVisibleToMembership(membership, vk.scopes),
      );
      return usageService(ctx.prisma, ctx.app.gateway).summary({
        organizationId: input.organizationId,
        virtualKeyIds: keys.map((k) => k.id),
        window: {
          fromDate: new Date(input.fromDate),
          toDate: new Date(input.toDate),
        },
      });
    }),

  summaryForVirtualKey: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        virtualKeyId: z.string(),
        fromDate: z.string().datetime(),
        toDate: z.string().datetime(),
        /** Narrows the recent-activity list, and nothing else, to one model. */
        model: z.string().min(1).max(256).optional(),
      }),
    )
    .use(
      authorizeInResolver({
        organizationId:
          "the key is loaded within this organization and must be visible to the caller's membership set; a miss is NOT_FOUND",
      }),
    )
    .query(async ({ ctx, input }) => {
      // Same visibility rule as virtualKeys.get: a key the caller can't
      // see is indistinguishable from one that doesn't exist.
      const vk = await ctx.app.gateway.virtualKeys.getById(
        input.virtualKeyId,
        input.organizationId,
      );
      if (!vk) {
        throw new VirtualKeyNotFoundError();
      }
      const membership = await loadMembershipSet(
        ctx.prisma,
        input.organizationId,
        ctx.session.user.id,
      );
      if (!isVisibleToMembership(membership, vk.scopes)) {
        throw new VirtualKeyNotFoundError();
      }
      return usageService(ctx.prisma, ctx.app.gateway).summaryForVirtualKey({
        organizationId: input.organizationId,
        virtualKeyId: input.virtualKeyId,
        window: {
          fromDate: new Date(input.fromDate),
          toDate: new Date(input.toDate),
        },
        model: input.model,
      });
    }),
});
