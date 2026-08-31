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
  type GovernanceService,
  isOttlEnabledSourceType,
  OTTL_ENABLED_SOURCE_TYPES,
} from "@langwatch/enterprise-governance-contract";
import { hasPollerCursor } from "@langwatch/enterprise-governance-server";
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
export function toIngestionSourceDto({
  row,
  liveTraceProjectIds,
}: {
  row: {
    id: string;
    organizationId: string;
    teamId: string | null;
    sourceType: string;
    name: string;
    description: string | null;
    parserConfig: unknown;
    // Required, not optional: if a future `select` clause stops fetching this,
    // `hasPollerCursor` would silently answer false for every source and the
    // edit form would offer a backfill start that cannot take effect. Better a
    // compile error than a setting that quietly does nothing.
    pollerCursor: unknown;
    // Required for the same reason as `pollerCursor` above: the edit form
    // seeds its cadence field from this column, and a `select` clause that
    // stopped fetching it would send the form back to the stale duplicate
    // inside parserConfig — which is the bug this field was added to close.
    pullSchedule: string | null;
    status: string;
    // Optional on the contract, never absent on a row Prisma read: normalised
    // to `null` below so the wire shape stays `string | null` and the key is
    // never dropped from the JSON by an `undefined`.
    traceProjectId?: string | null;
    lastEventAt: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    createdById: string | null;
  };
  /**
   * Of the destinations these rows point at, the ones still live in this
   * org. Anything else is archived, deleted, or was never ours — all three
   * mean the puller has stopped routing (`pullerWorker.ts:387-396`), which
   * is the one thing the drawer must say and cannot work out for itself.
   */
  liveTraceProjectIds: ReadonlySet<string>;
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
    /**
     * Whether a pull has already minted a cursor — NOT the cursor itself,
     * which is adapter-internal and of no use to a client.
     *
     * The edit form needs this to know whether the backfill start is still in
     * play: the usage cursor deliberately never rewinds, so once one exists
     * the setting is accepted and then ignored. `status` is not a usable proxy
     * for it in either direction — a source that pulled successfully but
     * recorded zero events is still `awaiting_first_event` while holding a
     * cursor, and one disabled before its first run never held one.
     */
    hasPollerCursor: hasPollerCursor(row.pollerCursor),
    /**
     * The cron the lifecycle actually runs this source on.
     *
     * `parserConfig` carries an adapter-owned copy under `schedule`, written
     * by the composer on create, and the two drift the moment anything writes
     * one without the other — `update` accepts this column on its own, and
     * seeds and migrations touch neither. The edit form used to seed from the
     * copy because this column never reached the client; it does now, so the
     * form shows the cadence that is running rather than the one that was
     * last written through the composer.
     *
     * Not a secret: a cron expression says how often we poll, nothing about
     * the credentials we poll with.
     */
    pullSchedule: row.pullSchedule,
    status: row.status,
    traceProjectId: row.traceProjectId ?? null,
    traceProjectArchived: row.traceProjectId ? !liveTraceProjectIds.has(row.traceProjectId) : false,
    lastEventAt: row.lastEventAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
  };
}

async function dtoForRow(
  service: GovernanceService,
  row: Parameters<typeof toIngestionSourceDto>[0]["row"],
  organizationId: string,
) {
  const liveTraceProjectIds = await service.ingestionSourceLiveTraceProjectIds(
    [row],
    organizationId,
  );
  return toIngestionSourceDto({ row, liveTraceProjectIds });
}

export const ingestionSourcesRouter = createTRPCRouter({
  /** List configured sources for an org. */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("ingestionSources:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      const rows = await service.ingestionSourceList(input.organizationId);
      // One destination query for the whole page rather than one per row.
      const liveTraceProjectIds = await service.ingestionSourceLiveTraceProjectIds(
        rows,
        input.organizationId,
      );
      return rows.map((row) => toIngestionSourceDto({ row, liveTraceProjectIds }));
    }),

  /** Get a single source by id (org-scoped). */
  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("ingestionSources:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      const row = await service.ingestionSourceGetById({
        id: input.id,
        organizationId: input.organizationId,
      });
      return dtoForRow(service, row, input.organizationId);
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
        traceProjectId: z.string().min(1).nullable().optional(),
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
        traceProjectId: input.traceProjectId,
        actorUserId: ctx.session.user.id,
      });
      return {
        source: await dtoForRow(service, created.source, input.organizationId),
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
        traceProjectId: z.string().min(1).nullable().optional(),
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
        traceProjectId: input.traceProjectId,
      });
      return dtoForRow(service, updated, input.organizationId);
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
      const rotated = await service.ingestionSourceRotateSecret({
        id: input.id,
        organizationId: input.organizationId,
      });
      return {
        source: await dtoForRow(service, rotated.source, input.organizationId),
        ingestSecret: rotated.ingestSecret,
      };
    }),

  archive: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("ingestionSources:manage")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      const archived = await service.ingestionSourceArchive({
        id: input.id,
        organizationId: input.organizationId,
      });
      return dtoForRow(service, archived, input.organizationId);
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
