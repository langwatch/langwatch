import { auditLog } from "~/runtime/app/features/audit-log";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getAllBugReports,
  getBugReportById,
} from "~/server/app-layer/bug-reports/bug-report.service";
import type { OpsService } from "@langwatch/ops-contract";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Admin-only reading of bug reports (the global support inbox fed by
 * `langwatch report` and the MCP report tool). Gated on the LangWatch staff
 * admin list, not on any organization role: reports are cross-tenant. Every
 * read is audit-logged: reports carry reporter-submitted transcripts and
 * contact emails.
 */
const requireAdmin = (user: { email?: string | null }, ops: OpsService) => {
  if (!ops.isAdmin(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
};

export const bugReportsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(50),
        search: z.string().max(200).optional(),
      }),
    )
    .noPermission({
      reason: "bug reports are filed by the session user about the app itself",
    })
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      requireAdmin(user, ctx.app.ops);
      await auditLog({
        userId: user.id,
        action: "bugReports.getAll",
        // Never the raw search text: contact searches are email addresses,
        // and audit rows outlive the inbox.
        args: {
          page: input.page,
          pageSize: input.pageSize,
          hasSearch: Boolean(input.search),
        },
        targetKind: "bugReport",
      });
      return getAllBugReports(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .noPermission({
      reason: "bug reports are filed by the session user about the app itself",
    })
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      requireAdmin(user, ctx.app.ops);
      await auditLog({
        userId: user.id,
        action: "bugReports.getById",
        targetKind: "bugReport",
        targetId: input.id,
      });
      const report = await getBugReportById(input);
      if (!report) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      }
      return report;
    }),
});
