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

import {
  GOVERNANCE_INGESTION_SOURCE_TYPES,
  getStarterTemplate,
  isOttlEnabledSourceType,
  OTTL_ENABLED_SOURCE_TYPES,
} from "@langwatch/enterprise-governance-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const sourceTypeSchema = z.enum(GOVERNANCE_INGESTION_SOURCE_TYPES);

const statusSchema = z.enum(["active", "disabled", "awaiting_first_event"]);

/**
 * Strip the secret-hash + private rotation slot before serialising
 * over the wire — the UI never needs them, and the secret-hash leaking
 * to a malicious admin would let them craft replay tokens. The
 * `_rotation` slot inside parserConfig is also stripped for the same
 * reason; it's an internal grace-window record, not user-facing.
 *
 * `credentials` goes the same way, and for exactly the same reason one step
 * further on. It is the upstream secret, sealed — unreadable, but not inert:
 * re-encryption is idempotent, so a client holding the envelope could send it
 * back beside a changed destination host and have us decrypt a secret it never
 * knew and post it there. The UI has no use for it either way; it collects a
 * fresh secret when one is being set and sends nothing when it is not.
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
    Object.entries(parser).filter(([k]) => !k.startsWith("_") && k !== "credentials"),
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
    .permission("ingestionSources:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      const rows = await service.ingestionSourceList(input.organizationId);
      return rows.map(toDto);
    }),

  /** Get a single source by id (org-scoped). */
  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("ingestionSources:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return toDto(await service.ingestionSourceGetById(input.id, input.organizationId));
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
        pullConfig: z.record(z.string(), z.unknown()).nullable().optional(),
        pullSchedule: z.string().min(1).max(64).nullable().optional(),
      }),
    )
    .permission("ingestionSources:manage")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      const created = await service.ingestionSourceCreate({
        organizationId: input.organizationId,
        teamId: input.teamId ?? null,
        sourceType: input.sourceType,
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
        pullSchedule: z.string().min(1).max(64).nullable().optional(),
      }),
    )
    .permission("ingestionSources:manage")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      const updated = await service.ingestionSourceUpdate({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        parserConfig: input.parserConfig,
        status: input.status,
        teamId: input.teamId,
        pullSchedule: input.pullSchedule,
      });
      return toDto(updated);
    }),

  /**
   * Mint a new ingest secret + retain the old hash for a 24h grace
   * window. Returns the new secret EXACTLY ONCE.
   */
  rotateSecret: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("ingestionSources:manage")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      const rotated = await service.ingestionSourceRotateSecret(
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
    .permission("ingestionSources:manage")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      const archived = await service.ingestionSourceArchive(
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
    .permission("ingestionSources:view")
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
   * When `LW_GATEWAY_BASE_URL` is unset (dev fast-path) or the gateway is up
   * but doesn't yet ship the endpoint, the client returns
   * `{ status: "deferred" }` — the composer still doesn't block on infra, but
   * the editor renders neutral dots plus a note rather than claiming a pass
   * for statements nothing looked at.
   */
  validateOttl: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        statements: z.array(z.string()).min(0).max(64),
      }),
    )
    .permission("ingestionSources:manage")
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.governance.ottlValidate(input.statements);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `OTTL validation request failed: ${(err as Error).message}`,
          cause: err,
        });
      }
    }),
});
