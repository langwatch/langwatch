// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for UserIngestionBinding — the user-side install/list/
 * uninstall/rotate flow for personal-project trace ingest.
 *
 * Cross-bind structural-impossibility: NONE of the input shapes carry
 * `personalProjectId`, `organizationId`, or `teamId`. Caller is
 * authenticated via `protectedProcedure`; the binding is scoped to the
 * caller's userId via `ctx.session.user.id`. The service layer
 * server-resolves the personal project from the User → personal Team →
 * personal Project ladder.
 *
 * The `skipPermissionCheck` middleware is the v1 gate: it confirms the
 * input shape has no sensitive scope keys + skips the project/org
 * permission ladder. Auth is purely "caller is signed in + owns a
 * personal project" — same shape as personalWorkspaceFeaturesRouter.
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

import { skipPermissionCheck } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const callerSelfGate = skipPermissionCheck();

export const userIngestionBindingsRouter = createTRPCRouter({
  /**
   * Caller's own bindings. Powers the /me Trace Ingest tile-grid's
   * "is this template installed" lookup so green-checked tile state
   * survives page reload.
   */
  list: protectedProcedure
    .input(z.object({}))
    .use(callerSelfGate)
    .query(async ({ ctx }) => {
      const service = UserIngestionBindingService.create(ctx.prisma);
      return await service.listForCaller({
        callerUserId: ctx.session.user.id,
      });
    }),

  /**
   * Install a binding for the caller against `templateId`. Server-resolves
   * the caller's personal project — input shape MUST NOT accept
   * personalProjectId (cross-bind structural-impossibility per spec).
   *
   * Returns the issued plaintext token ONCE. Subsequent reads only see
   * the prefix (8 chars).
   */
  install: protectedProcedure
    .input(
      z.object({
        templateId: z.string().min(1),
        // Optional opaque metadata for templates whose credentialSchema
        // is "static_api_key" or "agent_id". v1 ships only otlp_token
        // templates; the field stays null in practice but the path is
        // wired for v2 templates.
        encryptedCredential: z.unknown().optional(),
      }),
    )
    .use(callerSelfGate)
    .mutation(async ({ ctx, input }) => {
      const service = UserIngestionBindingService.create(ctx.prisma);
      try {
        return await service.install({
          callerUserId: ctx.session.user.id,
          templateId: input.templateId,
          encryptedCredential:
            input.encryptedCredential as
              | Parameters<typeof service.install>[0]["encryptedCredential"],
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
    .input(z.object({ bindingId: z.string().min(1) }))
    .use(callerSelfGate)
    .mutation(async ({ ctx, input }) => {
      const service = UserIngestionBindingService.create(ctx.prisma);
      try {
        await service.uninstall({
          callerUserId: ctx.session.user.id,
          bindingId: input.bindingId,
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
    .input(z.object({ bindingId: z.string().min(1) }))
    .use(callerSelfGate)
    .mutation(async ({ ctx, input }) => {
      const service = UserIngestionBindingService.create(ctx.prisma);
      try {
        return await service.rotateToken({
          callerUserId: ctx.session.user.id,
          bindingId: input.bindingId,
        });
      } catch (err) {
        if (err instanceof BindingNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),
});
