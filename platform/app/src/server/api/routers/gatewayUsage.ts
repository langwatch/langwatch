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

import { getApp } from "~/server/app-layer/app";
import { VirtualKeyNotFoundError } from "~/server/gateway/errors";
import { GatewayUsageService } from "~/server/gateway/usage.service";
import {
  isVisibleToMembership,
  loadMembershipSet,
} from "~/server/gateway/virtualKey.authz";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";

import { authorizeInResolver } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

function usageService(prisma: PrismaClient) {
  return GatewayUsageService.create({
    prisma,
    chRepo: getApp().gateway.budgets,
    spendRepo: getApp().gateway.virtualKeySpend,
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
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      const membership = await loadMembershipSet(
        ctx.prisma,
        input.organizationId,
        ctx.session.user.id,
      );
      const keys = (
        await VirtualKeyService.create(ctx.prisma).getAll(input.organizationId)
      ).filter((vk) => isVisibleToMembership(membership, vk.scopes));
      return usageService(ctx.prisma).summary({
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
      }),
    )
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      // Same visibility rule as virtualKeys.get: a key the caller can't
      // see is indistinguishable from one that doesn't exist.
      const vk = await VirtualKeyService.create(ctx.prisma).getById(
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
      return usageService(ctx.prisma).summaryForVirtualKey({
        organizationId: input.organizationId,
        virtualKeyId: input.virtualKeyId,
        window: {
          fromDate: new Date(input.fromDate),
          toDate: new Date(input.toDate),
        },
      });
    }),
});
