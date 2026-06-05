// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for ingestion keys — the user-side mint/rotate/list flow for
 * personal-project trace ingest. An "ingestion key" is one row of the single
 * ApiKey primitive (`sk-lw-`) carrying a non-null `ingestSourceType`.
 *
 * `organizationId` IS accepted in the input: a user can have a personal
 * project per org they're a member of, and the caller's currently-active
 * org disambiguates which one to mint into. RBAC validates the caller is a
 * member of `organizationId` via `checkOrganizationPermission`
 * ("organization:view") — every org member has that permission, so the gate
 * is "are you a member of this org", mirroring the retired binding router.
 *
 * Mint and rotate share one service call: IngestionKeyService rotates in
 * place (revokes any prior live key for the (project, sourceType) pair
 * before issuing the new one), so a tool never accumulates keys.
 */
import { z } from "zod";

import { IngestionKeyService } from "@ee/governance/services/ingestionKey.service";

import { env } from "~/env.mjs";
import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const mintInput = z.object({
  organizationId: z.string(),
  sourceType: z.string().min(1),
  templateId: z.string().min(1).optional(),
});

/**
 * The OTLP endpoint a sysadmin pastes into a company-wide tool (Copilot Studio,
 * etc.). Mirrors controlPlaneBaseUrl() in auth-cli.ts so dev / staging / prod
 * resolve without per-env config.
 */
function otlpEndpoint(): string {
  const base =
    env.NEXTAUTH_URL ?? env.BASE_HOST ?? "https://app.langwatch.ai";
  return `${base.replace(/\/+$/, "")}/api/otel`;
}

export const ingestionKeyRouter = createTRPCRouter({
  /**
   * The caller's live ingestion keys within the active org. Powers the /me
   * Trace Ingest grid's "is this source connected" lookup so green-checked
   * tile state survives a reload.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      return await service.listForPersonalProject({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
    }),

  /**
   * Mint (rotating in place) an ingestion key for the caller's personal
   * project + sourceType. Returns the plaintext token ONCE; subsequent
   * reads only see the source list.
   */
  install: protectedProcedure
    .input(mintInput)
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      return await service.ensureForPersonalProject({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        ingestionTemplateId: input.templateId ?? null,
      });
    }),

  /**
   * Hard-cut rotation: re-mint the key for (personal project, sourceType).
   * The previous token is revoked immediately, so any tool still using it
   * starts failing auth on its next request.
   */
  rotate: protectedProcedure
    .input(mintInput)
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      return await service.ensureForPersonalProject({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        ingestionTemplateId: input.templateId ?? null,
      });
    }),

  // ── Company-wide push ingestion (org Governance Project) ──────────────────
  // A sysadmin mints ONE key bound to the org's hidden Governance Project and
  // pastes it into a company-wide tool's OTLP endpoint (e.g. Copilot Studio),
  // so the whole company's telemetry pushes into one governed project. Gated
  // on the ingestion-source admin permission — a stronger gate than the
  // personal "are you a member of this org".

  /** Live company-wide ingestion keys + the OTLP endpoint to paste into the tool. */
  companyWideList: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("ingestionSources:view"))
    .query(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      const sources = await service.listForOrganizationGovernanceProject({
        organizationId: input.organizationId,
      });
      return { endpoint: otlpEndpoint(), sources };
    }),

  /** Mint (rotating in place) a company-wide key; reveals the token once. */
  companyWideInstall: protectedProcedure
    .input(mintInput)
    .use(checkOrganizationPermission("ingestionSources:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      const result = await service.ensureForOrganizationGovernanceProject({
        callerUserId: ctx.session.user.id,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        ingestionTemplateId: input.templateId ?? null,
      });
      return { ...result, endpoint: otlpEndpoint() };
    }),

  /** Hard-cut rotation of the company-wide key (the previous token dies). */
  companyWideRotate: protectedProcedure
    .input(mintInput)
    .use(checkOrganizationPermission("ingestionSources:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionKeyService.create(ctx.prisma);
      const result = await service.ensureForOrganizationGovernanceProject({
        callerUserId: ctx.session.user.id,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        ingestionTemplateId: input.templateId ?? null,
      });
      return { ...result, endpoint: otlpEndpoint() };
    }),
});
