// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for ingestion keys: the user-side list/install/rotate/revoke
 * flow for personal-project trace ingest. An "ingestion key" is one row of
 * the single ApiKey primitive (`ik-lw-`) carrying a non-null
 * `ingestSourceType`.
 *
 * `organizationId` IS accepted in the input: a user can have a personal
 * project per org they're a member of, and the caller's currently-active
 * org disambiguates which one to mint into. RBAC validates the caller is a
 * member of `organizationId` via `checkOrganizationPermission`
 * ("organization:view") — every org member has that permission, so the gate
 * is "are you a member of this org", mirroring the retired binding router.
 *
 * Every mint here has no CLI session behind it, so it accepts only sources a
 * published template names: a tool the CLI wraps gets its key from the
 * machine that runs it, parented to that machine's session.
 */

import { auditLog } from "@ee/audit-log/auditLog";
import { IngestionKeyService } from "@ee/governance/services/ingestionKey.service";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const logger = createLogger("langwatch:governance:ingestion-key-router");

const mintInput = z.object({
  organizationId: z.string(),
  sourceType: z.string().min(1),
  templateId: z.string().min(1).optional(),
});

export const ingestionKeyRouter = createTRPCRouter({
  /**
   * The caller's live ingestion keys within the active org, with the CLI
   * session each belongs to. Powers the /me Trace Ingest grid's "is this
   * source connected" lookup and the devices tab's per-session key list.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      return await service.list({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
    }),

  /**
   * Connect a source: mint an ingestion key for the caller's personal project
   * + sourceType. Returns the plaintext token ONCE; subsequent reads only see
   * the source list.
   *
   * Create-only. Connecting a source says nothing about the machines already
   * exporting for it, so their keys stay live; `rotate` is the verb that
   * kills them.
   */
  install: protectedProcedure
    .input(mintInput)
    .permission("organization:view")
    .mutation(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      const issued = await service.mint({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        ingestionTemplateId: input.templateId ?? null,
      });
      void auditLog({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        action: "ingestionKey.mint",
        args: { apiKeyId: issued.apiKeyId, sourceType: input.sourceType },
      }).catch((error: unknown) =>
        logger.warn(
          { error, apiKeyId: issued.apiKeyId },
          "could not write the ingestionKey.mint audit row",
        ),
      );
      return issued;
    }),

  /**
   * Rotate a source: revoke every live key for (personal project, sourceType,
   * template) across every machine, then mint one. The previous tokens are
   * refused from that moment on, and the answer says how many there were
   * and which machines held them, so the person knows where to paste the
   * new one.
   */
  rotate: protectedProcedure
    .input(mintInput)
    .permission("organization:view")
    .mutation(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      const revoked = await service.revokeForSource({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        ingestionTemplateId: input.templateId ?? null,
      });
      const issued = await service.mint({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        ingestionTemplateId: input.templateId ?? null,
      });
      void auditLog({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        action: "ingestionKey.rotate",
        args: {
          apiKeyId: issued.apiKeyId,
          sourceType: input.sourceType,
          revokedCount: revoked.revokedCount,
        },
      }).catch((error: unknown) =>
        logger.warn(
          { error, apiKeyId: issued.apiKeyId },
          "could not write the ingestionKey.rotate audit row",
        ),
      );
      return {
        ...issued,
        revokedCount: revoked.revokedCount,
        revokedDeviceLabels: revoked.deviceLabels,
      };
    }),

  /**
   * Revoke one of the caller's own ingestion keys, from the devices tab or
   * the API-keys page. Idempotent: a key already revoked stays revoked and
   * the call succeeds.
   */
  revoke: protectedProcedure
    .input(z.object({ organizationId: z.string(), apiKeyId: z.string() }))
    .permission("organization:view")
    .mutation(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      await service.revoke({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        apiKeyId: input.apiKeyId,
      });
      // The revoke reports success only once its audit row is durable: the
      // key is already dead, and the row is the record of who killed it.
      await auditLog({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        action: "ingestionKey.revoke",
        args: { apiKeyId: input.apiKeyId },
      });
      return { success: true };
    }),
});
