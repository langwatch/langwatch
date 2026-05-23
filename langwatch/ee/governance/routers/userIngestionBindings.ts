// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for UserIngestionBinding — the user-side install/list/
 * uninstall/rotate flow for personal-project trace ingest.
 *
 * Cross-bind structural-impossibility: NONE of the input shapes carry
 * `personalProjectId` (or `teamId`). The cross-bind invariant is the
 * caller cannot bind into ANOTHER USER'S personal project — the service
 * asserts `Project.ownerUserId === callerUserId` server-side.
 *
 * `organizationId` IS accepted in the input: a user can have a personal
 * project per org they're a member of, and the caller's currently-
 * active org disambiguates which one to install into. RBAC validates
 * the caller is a member of `organizationId` via
 * `checkOrganizationPermission("organization:view")` — every org member
 * has that permission, so the gate is "are you a member of this org",
 * not a stricter admin check.
 *
 * Spec:
 *   specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature
 *   specs/ai-gateway/governance/template-cross-bind-guard.feature
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  BindingAlreadyExistsError,
  BindingNotFoundError,
  IngestionTemplateNotFoundError,
  PersonalProjectMissingError,
  UserIngestionBindingService,
} from "@ee/governance/services/userIngestionBinding.service";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userIngestionBindingsRouter = createTRPCRouter({
  /**
   * Caller's own bindings within the active org. Powers the /me Trace
   * Ingest tile-grid's "is this template installed" lookup so green-
   * checked tile state survives page reload.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = UserIngestionBindingService.create(ctx.prisma);
      return await service.listForCaller({
        callerUserId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
    }),

  /**
   * Install a binding for the caller against `templateId`. Server-resolves
   * the caller's personal project within `organizationId` — input shape
   * MUST NOT accept personalProjectId (cross-bind structural-impossibility
   * per spec).
   *
   * Returns the issued plaintext token ONCE. Subsequent reads only see
   * the prefix (9 chars).
   */
  install: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        templateId: z.string().min(1),
        // Optional opaque metadata for templates whose credentialSchema
        // is "static_api_key" or "agent_id". v1 ships only otlp_token
        // templates; the field stays null in practice but the path is
        // wired for v2 templates.
        encryptedCredential: z.unknown().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx, input }) => {
      const service = UserIngestionBindingService.create(ctx.prisma);
      try {
        return await service.install({
          callerUserId: ctx.session.user.id,
          organizationId: input.organizationId,
          templateId: input.templateId,
          encryptedCredential:
            input.encryptedCredential as
              | Parameters<typeof service.install>[0]["encryptedCredential"],
          surface: "trpc",
        });
      } catch (err) {
        if (err instanceof PersonalProjectMissingError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
        }
        if (err instanceof IngestionTemplateNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        if (err instanceof BindingAlreadyExistsError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        throw err;
      }
    }),

  uninstall: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        bindingId: z.string().min(1),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx, input }) => {
      const service = UserIngestionBindingService.create(ctx.prisma);
      try {
        await service.uninstall({
          callerUserId: ctx.session.user.id,
          organizationId: input.organizationId,
          bindingId: input.bindingId,
          surface: "trpc",
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof BindingNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Hard-cut rotation v1: returns the new plaintext token; the previous
   * token is invalidated immediately. Spec scenario @rotation @hard-cut
   * pins this behavior.
   */
  rotateToken: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        bindingId: z.string().min(1),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx, input }) => {
      const service = UserIngestionBindingService.create(ctx.prisma);
      try {
        return await service.rotateToken({
          callerUserId: ctx.session.user.id,
          organizationId: input.organizationId,
          bindingId: input.bindingId,
          surface: "trpc",
        });
      } catch (err) {
        if (err instanceof BindingNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),
});
