import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { dataPrivacyConfigSchema } from "~/server/data-privacy/dataPrivacy.types";
import {
  assertCanWriteDataPrivacyScope,
  assertScopeBelongsToProjectOrganization,
} from "~/server/data-privacy/dataPrivacyPolicy.authz";
import { getDataPrivacySnapshot } from "~/server/data-privacy/dataPrivacyPolicy.read";
import {
  getDataPrivacyPolicyService,
  InvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError,
} from "~/server/data-privacy/dataPrivacyPolicy.service";
import { authorizeInResolver, checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const scopeInput = z.object({
  scopeType: z.enum(["ORGANIZATION", "DEPARTMENT", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

export const dataPrivacyRouter = createTRPCRouter({
  /**
   * The privacy settings snapshot for a project: the effective resolved policy,
   * the RBAC-filtered rules grouped by scope, and the scopes the caller may
   * write (for the chip picker). Read access is project:view; the snapshot
   * itself filters what it returns.
   */
  getSnapshot: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      return getDataPrivacySnapshot(
        { prisma: ctx.prisma, session: ctx.session },
        { projectId: input.projectId },
      );
    }),

  /**
   * Write the privacy rule at one (scope, personalOnly) target. Authorizes write
   * on the target scope — ORGANIZATION/DEPARTMENT need organization:manage, TEAM
   * needs team:manage, PROJECT needs project:update — so a project member cannot
   * push a rule up to the organization.
   */
  setForScope: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scope: scopeInput,
        personalOnly: z.boolean(),
        config: dataPrivacyConfigSchema,
      }),
    )
    .use(authorizeInResolver)
    .mutation(async ({ input, ctx }) => {
      const authCtx = { prisma: ctx.prisma, session: ctx.session };
      await assertScopeBelongsToProjectOrganization(
        authCtx,
        input.projectId,
        input.scope,
      );
      await assertCanWriteDataPrivacyScope(authCtx, input.scope);
      try {
        return await getDataPrivacyPolicyService().setForScope({
          scope: input.scope,
          personalOnly: input.personalOnly,
          config: input.config,
        });
      } catch (error) {
        if (error instanceof ScopeTargetNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        if (error instanceof InvalidDataPrivacyConfigError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  /** Remove the rule at one (scope, personalOnly) target; the next tier then applies. */
  removeForScope: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scope: scopeInput,
        personalOnly: z.boolean(),
      }),
    )
    .use(authorizeInResolver)
    .mutation(async ({ input, ctx }) => {
      const authCtx = { prisma: ctx.prisma, session: ctx.session };
      await assertScopeBelongsToProjectOrganization(
        authCtx,
        input.projectId,
        input.scope,
      );
      await assertCanWriteDataPrivacyScope(authCtx, input.scope);
      await getDataPrivacyPolicyService().removeForScope({
        scope: input.scope,
        personalOnly: input.personalOnly,
      });
    }),
});
