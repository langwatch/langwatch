import { ConnectSettingsService } from "@ee/licensing/connect/install/connectSettings.service";
import { CONNECT_SERVICES } from "@ee/licensing/connect/services";
import { z } from "zod";
import { prisma } from "~/server/db";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * What an organization does with LangWatch-hosted services on a self-hosted
 * install: read the state, switch a service on or off, set its own cap
 * (ADR-141).
 *
 * Every decision is the service's; this names the permission each one needs.
 * Reading is any member's, because the page explains why hosted judging is or
 * is not running and that is not privileged. Both writes are an organization
 * management right: one decides what leaves the install, the other decides
 * what the install may spend.
 */

const organizationInput = z.object({ organizationId: z.string().min(1) });

const service = () => new ConnectSettingsService({ prisma });

export const connectRouter = createTRPCRouter({
  status: protectedProcedure
    .input(organizationInput)
    .permission("organization:view")
    .query(async ({ input }) => await service().status(input.organizationId)),

  setService: protectedProcedure
    .input(
      organizationInput.extend({
        service: z.enum(CONNECT_SERVICES),
        enabled: z.boolean(),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ input }) => await service().setService(input)),

  setCap: protectedProcedure
    .input(organizationInput.extend({ capUsd: z.number().positive().finite() }))
    .permission("organization:manage")
    .mutation(async ({ input }) => await service().setCap(input)),
});
