// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for IngestionSource admin CRUD.
 *
 * RBAC: gates on the resource-specific catalog
 * (`ingestionSources:view` for reads, `ingestionSources:manage` for
 * mutations). MEMBER + EXTERNAL roles get neither by default — only
 * org ADMIN or a custom-role binding granting these permissions.
 * The old `organization:view`/`organization:manage` gate leaked
 * read access to MEMBER. Mirrors the catalog defined in api/rbac.ts.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * The actual ingest receivers (push-mode for OTel/webhook, pull-mode
 * for compliance APIs) live under `/api/ingest/*` Hono routes — this
 * file is just the admin-side configuration surface that powers the
 * /settings/ingestion-sources UI.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  IngestionSourceService,
  SUPPORTED_SOURCE_TYPES,
} from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { validateOttlStatements } from "@ee/governance/services/activity-monitor/ottlGatewayClient";
import {
  getStarterTemplate,
  isOttlEnabledSourceType,
  OTTL_ENABLED_SOURCE_TYPES,
} from "@ee/governance/services/activity-monitor/ottlStarterTemplates";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const sourceTypeSchema = z.enum(
  SUPPORTED_SOURCE_TYPES as readonly [string, ...string[]],
);

const statusSchema = z.enum(["active", "disabled", "awaiting_first_event"]);

/**
 * Strip the secret-hash + private rotation slot before serialising
 * over the wire — the UI never needs them, and the secret-hash leaking
 * to a malicious admin would let them craft replay tokens. The
 * `_rotation` slot inside parserConfig is also stripped for the same
 * reason; it's an internal grace-window record, not user-facing.
 */
function toDto(row: {
  id: string;
  organizationId: string;
  teamId: string | null;
  sourceType: string;
  name: string;
  description: string | null;
  parserConfig: unknown;
  status: string;
  lastEventAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
}) {
  const parser = (row.parserConfig as Record<string, unknown>) ?? {};
  const safeParser = Object.fromEntries(
    Object.entries(parser).filter(([k]) => !k.startsWith("_")),
  );
  return {
    id: row.id,
    organizationId: row.organizationId,
    teamId: row.teamId,
    sourceType: row.sourceType,
    name: row.name,
    description: row.description,
    parserConfig: safeParser,
    status: row.status,
    lastEventAt: row.lastEventAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
  };
}

export const ingestionSourcesRouter = createTRPCRouter({
  /** List configured sources for an org. */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("ingestionSources:view"))
    .query(async ({ ctx, input }) => {
      const service = IngestionSourceService.create(ctx.prisma);
      const rows = await service.list(input.organizationId);
      return rows.map(toDto);
    }),

  /** Get a single source by id (org-scoped). */
  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("ingestionSources:view"))
    .query(async ({ ctx, input }) => {
      const service = IngestionSourceService.create(ctx.prisma);
      const row = await service.findById(input.id, input.organizationId);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return toDto(row);
    }),

  /**
   * Create a new IngestionSource. Returns the freshly-minted ingest
   * secret EXACTLY ONCE — UI must surface it to the admin before
   * navigating away (after which it's unrecoverable, per the spec).
   */
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        teamId: z.string().nullable().optional(),
        sourceType: sourceTypeSchema,
        name: z.string().min(1).max(128),
        description: z.string().nullable().optional(),
        parserConfig: z.record(z.string(), z.unknown()).optional(),
        pullConfig: z
          .record(z.string(), z.unknown())
          .nullable()
          .optional(),
        pullSchedule: z.string().min(1).max(64).nullable().optional(),
      }),
    )
    .use(checkOrganizationPermission("ingestionSources:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionSourceService.create(ctx.prisma);
      const created = await service.createSource({
        organizationId: input.organizationId,
        teamId: input.teamId ?? null,
        sourceType: input.sourceType as (typeof SUPPORTED_SOURCE_TYPES)[number],
        name: input.name,
        description: input.description ?? null,
        parserConfig: input.parserConfig,
        pullConfig: input.pullConfig,
        pullSchedule: input.pullSchedule,
        actorUserId: ctx.session.user.id,
      });
      return {
        source: toDto(created.source),
        ingestSecret: created.ingestSecret,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        parserConfig: z.record(z.string(), z.unknown()).optional(),
        status: statusSchema.optional(),
        teamId: z.string().nullable().optional(),
      }),
    )
    .use(checkOrganizationPermission("ingestionSources:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionSourceService.create(ctx.prisma);
      const updated = await service.updateSource({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        parserConfig: input.parserConfig,
        status: input.status,
        teamId: input.teamId,
      });
      return toDto(updated);
    }),

  /**
   * Mint a new ingest secret + retain the old hash for a 24h grace
   * window. Returns the new secret EXACTLY ONCE.
   */
  rotateSecret: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("ingestionSources:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionSourceService.create(ctx.prisma);
      const rotated = await service.rotateSecret(
        input.id,
        input.organizationId,
      );
      return {
        source: toDto(rotated.source),
        ingestSecret: rotated.ingestSecret,
      };
    }),

  archive: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("ingestionSources:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionSourceService.create(ctx.prisma);
      const archived = await service.archive(
        input.id,
        input.organizationId,
      );
      return toDto(archived);
    }),

  /**
   * Static helper for the composer/drawer: returns the canonical OTTL
   * starter statements for a source type and whether OTTL editing is
   * enabled for it. Pure function over a constant — but exposed via
   * tRPC so the catalog stays a single source of truth (and so we can
   * later swap the starter map for an admin-curated set without a
   * client redeploy).
   */
  ottlStarter: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        sourceType: z.string(),
      }),
    )
    .use(checkOrganizationPermission("ingestionSources:view"))
    .query(({ input }) => {
      return {
        enabled: isOttlEnabledSourceType(input.sourceType),
        statements: [...getStarterTemplate(input.sourceType)],
        enabledSourceTypes: [...OTTL_ENABLED_SOURCE_TYPES],
      };
    }),

  /**
   * Validate a list of OTTL statements via the aigateway. The gateway
   * embeds `pkg/ottl` from the OpenTelemetry Collector and parses each
   * statement; on parse / type errors, returns per-statement coordinates
   * so the editor can surface line/col error markers.
   *
   * When `LW_GATEWAY_BASE_URL` is unset (dev fast-path) or the gateway
   * is up but doesn't yet ship the endpoint, the client returns
   * `{ ok: true }` so the composer doesn't block on infra.
   */
  validateOttl: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        statements: z.array(z.string()).min(0).max(64),
      }),
    )
    .use(checkOrganizationPermission("ingestionSources:manage"))
    .mutation(async ({ input }) => {
      try {
        return await validateOttlStatements(input.statements);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `OTTL validation request failed: ${(err as Error).message}`,
          cause: err,
        });
      }
    }),
});
