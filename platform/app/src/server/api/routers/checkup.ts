import { setUsageReportSwitches } from "@ee/licensing/connect/install/instanceIdentity";
import { z } from "zod";
import { env } from "~/env.mjs";
import {
  checkupFor,
  realUsageReportPreview,
} from "~/server/checkup/checkup.deps";
import { CHECK_IDS } from "~/server/checkup/verdict";
import { prisma } from "~/server/db";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Settings, Checkup on a self-hosted install
 * (specs/self-hosting/checkup/checkup.feature).
 *
 * Reading is any member's: whether the install is wired is not privileged,
 * and the person opening the page to find out why something stopped is the
 * one who needs the answer. Running a check that costs egress or money, and
 * changing what the install reports, are organization management rights.
 *
 * Same shape on LangWatch Cloud, where every procedure answers "not a
 * self-hosted install": the page is not linked there, and the type of the
 * router has to hold either way.
 */

const organizationInput = z.object({ organizationId: z.string().min(1) });

const runInput = organizationInput.extend({
  checks: z.array(z.enum(CHECK_IDS)).optional(),
  scenarioRunPlanId: z.string().min(1).max(200).optional(),
});

const switchesInput = organizationInput.extend({
  optionalMetricsOptOut: z.boolean().optional(),
  hostnameOptOut: z.boolean().optional(),
});

export const checkupRouter = createTRPCRouter({
  status: protectedProcedure
    .input(organizationInput)
    .permission("organization:view")
    .query(async ({ input }) => {
      if (env.IS_SAAS) return { deployment: "saas" as const };
      const result = await checkupFor({
        prisma,
        organizationId: input.organizationId,
      }).cheap();
      return { deployment: "self-hosted" as const, ...result };
    }),

  run: protectedProcedure
    .input(runInput)
    .permission("organization:manage")
    .mutation(async ({ input }) => {
      if (env.IS_SAAS) return { deployment: "saas" as const };
      const result = await checkupFor({
        prisma,
        organizationId: input.organizationId,
      }).explicit({
        ...(input.checks ? { checks: input.checks } : {}),
        ...(input.scenarioRunPlanId
          ? { scenarioRunPlanId: input.scenarioRunPlanId }
          : {}),
      });
      return { deployment: "self-hosted" as const, ...result };
    }),

  usageReport: protectedProcedure
    .input(organizationInput)
    .permission("organization:view")
    .query(async () => {
      if (env.IS_SAAS) return { deployment: "saas" as const };
      const preview = await realUsageReportPreview(prisma);
      return { deployment: "self-hosted" as const, ...preview };
    }),

  setUsageReportSwitches: protectedProcedure
    .input(switchesInput)
    .permission("organization:manage")
    .mutation(async ({ input }) => {
      if (env.IS_SAAS) return { deployment: "saas" as const };
      await setUsageReportSwitches({
        prisma,
        ...(input.optionalMetricsOptOut === undefined
          ? {}
          : { optionalMetricsOptOut: input.optionalMetricsOptOut }),
        ...(input.hostnameOptOut === undefined
          ? {}
          : { hostnameOptOut: input.hostnameOptOut }),
      });
      const preview = await realUsageReportPreview(prisma);
      return { deployment: "self-hosted" as const, ...preview };
    }),
});
