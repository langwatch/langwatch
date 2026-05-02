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
  SUPPORTED_RETENTION_CLASSES,
  SUPPORTED_SOURCE_TYPES,
} from "~/server/governance/activity-monitor/ingestionSource.service";

import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const retentionClassSchema = z.enum(
  SUPPORTED_RETENTION_CLASSES as readonly [string, ...string[]],
);

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
  retentionClass: string;
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
    retentionClass: row.retentionClass,
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
        retentionClass: retentionClassSchema.optional(),
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
        retentionClass: input.retentionClass as
          | (typeof SUPPORTED_RETENTION_CLASSES)[number]
          | undefined,
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
        retentionClass: retentionClassSchema.optional(),
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
        retentionClass: input.retentionClass as
          | (typeof SUPPORTED_RETENTION_CLASSES)[number]
          | undefined,
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
});
