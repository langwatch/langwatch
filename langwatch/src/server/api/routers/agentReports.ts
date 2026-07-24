import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getAgentReportById,
  getAllAgentReports,
} from "~/server/app-layer/agent-reports/agent-report.service";
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import { skipPermissionCheck } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Admin-only reading of agent issue reports (the global support inbox fed by
 * `langwatch report` and the MCP report tool). Gated on the LangWatch staff
 * admin list, not on any organization role: reports are cross-tenant.
 */
const requireAdmin = (user: { email?: string | null }) => {
  if (!checkIsAdmin(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
};

export const agentReportsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(50),
        search: z.string().max(200).optional(),
      }),
    )
    .use(skipPermissionCheck)
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      requireAdmin(user);
      return getAllAgentReports(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(skipPermissionCheck)
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      requireAdmin(user);
      const report = await getAgentReportById(input);
      if (!report) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      }
      return report;
    }),
});
