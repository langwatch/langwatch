/**
 * IngestionSource admin CRUD tRPC surface.
 *
 * Reads gate on `ingestionSources:view`, writes on `ingestionSources:manage` —
 * MEMBER and EXTERNAL roles never see the surface. The actual ingest
 * receivers (push-mode for OTel / webhook, pull-mode for compliance APIs)
 * live under `/api/ingest/*` Hono routes; this is the admin-side
 * configuration surface that powers /settings/ingestion-sources.
 *
 * `toIngestionSourceDto` scrubs the parser config's private slots and the
 * sealed credentials envelope before serialising — the UI never needs them,
 * and the sealed envelope is not inert: re-encryption is idempotent, so a
 * client that could send it back beside a changed destination host would
 * have us decrypt a secret it never knew and post it there. The wire never
 * carries either.
 *
 * `validateOttl` deliberately re-throws the underlying network error rather
 * than wrapping it into a HandledError — the caller cannot act on a gateway
 * outage, so the boundary correctly degrades to "unknown" with a trace id.
 *
 * Transport only: input parsing, delegation, wire shape, DTO scrubbing.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  GOVERNANCE_INGESTION_SOURCE_TYPES,
  getStarterTemplate,
  isOttlEnabledSourceType,
  OTTL_ENABLED_SOURCE_TYPES,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { hasPollerCursor } from "../../adapters/poller-cursor.adapter";

export type IngestionSourcesTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type IngestionSourcesTrpcProcedures<
  TContext extends IngestionSourcesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

const sourceTypeSchema = z.enum(GOVERNANCE_INGESTION_SOURCE_TYPES);
const statusSchema = z.enum(["active", "disabled", "awaiting_first_event"]);
const organizationScope = z.object({ organizationId: z.string() });
const idAndOrg = organizationScope.extend({ id: z.string() });

const createSchema = organizationScope.extend({
  teamId: z.string().nullable().optional(),
  sourceType: sourceTypeSchema,
  name: z.string().min(1).max(128),
  description: z.string().nullable().optional(),
  parserConfig: z.record(z.string(), z.unknown()).optional(),
  pullConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  pullSchedule: z.string().min(1).max(64).nullable().optional(),
  traceProjectId: z.string().min(1).nullable().optional(),
});

const updateSchema = idAndOrg.extend({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  parserConfig: z.record(z.string(), z.unknown()).optional(),
  status: statusSchema.optional(),
  teamId: z.string().nullable().optional(),
  pullSchedule: z.string().min(1).max(64).nullable().optional(),
  traceProjectId: z.string().min(1).nullable().optional(),
});

const ottlStarterSchema = organizationScope.extend({ sourceType: z.string() });

const validateOttlSchema = organizationScope.extend({
  statements: z.array(z.string()).min(0).max(64),
});

type IngestionSourceRow = Readonly<{
  id: string;
  organizationId: string;
  teamId: string | null;
  sourceType: string;
  name: string;
  description: string | null;
  parserConfig: unknown;
  // Required, not optional: if a future `select` clause stops fetching this,
  // `hasPollerCursor` would silently answer false for every source and the
  // edit form would offer a backfill start that cannot take effect.
  pollerCursor: unknown;
  // Required for the same reason: the edit form seeds its cadence field from
  // this column, and dropping it would send the form back to the stale
  // duplicate inside parserConfig — the bug this field was added to close.
  pullSchedule: string | null;
  status: string;
  // Optional on the contract, never absent on a Prisma read: normalised to
  // `null` below so the wire shape stays `string | null`.
  traceProjectId?: string | null;
  lastEventAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
}>;

/**
 * Strip the secret hash, private rotation slot and sealed credentials
 * envelope before serialising over the wire. See file docblock for why the
 * envelope in particular must not travel.
 *
 * Exported for the very few places that need to shape a row for tests or a
 * REST equivalent — everything on the wire goes through it.
 */
export function toIngestionSourceDto({
  row,
  liveTraceProjectIds,
}: {
  row: IngestionSourceRow;
  /**
   * Of the destinations these rows point at, the ones still live in this
   * org. Anything else is archived, deleted, or was never ours — all three
   * mean the puller has stopped routing.
   */
  liveTraceProjectIds: ReadonlySet<string>;
}) {
  const parser = (row.parserConfig as Record<string, unknown>) ?? {};
  const safeParser = Object.fromEntries(
    Object.entries(parser).filter(([key]) => !key.startsWith("_") && key !== "credentials"),
  );
  return {
    id: row.id,
    organizationId: row.organizationId,
    teamId: row.teamId,
    sourceType: row.sourceType,
    name: row.name,
    description: row.description,
    parserConfig: safeParser,
    hasPollerCursor: hasPollerCursor(row.pollerCursor),
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
  row: IngestionSourceRow,
  organizationId: string,
) {
  const liveTraceProjectIds = await service.ingestionSourceLiveTraceProjectIds(
    [row],
    organizationId,
  );
  return toIngestionSourceDto({ row, liveTraceProjectIds });
}

/** Installs the `ingestionSources.*` tRPC surface on a process root. */
export class IngestionSourcesTrpcApi {
  static create<
    TContext extends IngestionSourcesTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: IngestionSourcesTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    const view = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
      policy("ingestionSources:view")(procedure.input(schema));
    const manage = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
      policy("ingestionSources:manage")(procedure.input(schema));

    return trpc.router({
      /** List configured sources for an org. */
      list: view(organizationScope).query(async ({ ctx, input }) => {
        const rows = await ctx.app.governance.ingestionSourceList(input.organizationId);
        // One destination query for the whole page rather than one per row.
        const liveTraceProjectIds = await ctx.app.governance.ingestionSourceLiveTraceProjectIds(
          rows,
          input.organizationId,
        );
        return rows.map((row) => toIngestionSourceDto({ row, liveTraceProjectIds }));
      }),

      /** Get a single source by id (org-scoped). */
      get: view(idAndOrg).query(async ({ ctx, input }) => {
        const row = await ctx.app.governance.ingestionSourceGetById({
          id: input.id,
          organizationId: input.organizationId,
        });
        return dtoForRow(ctx.app.governance, row, input.organizationId);
      }),

      /**
       * Create a new IngestionSource. Returns the freshly-minted ingest
       * secret EXACTLY ONCE — the UI must surface it to the admin before
       * navigating away (after which it is unrecoverable).
       */
      create: manage(createSchema).mutation(async ({ ctx, input }) => {
        const created = await ctx.app.governance.ingestionSourceCreate({
          organizationId: input.organizationId,
          teamId: input.teamId ?? null,
          sourceType: input.sourceType,
          name: input.name,
          description: input.description ?? null,
          parserConfig: input.parserConfig,
          pullConfig: input.pullConfig,
          pullSchedule: input.pullSchedule,
          traceProjectId: input.traceProjectId,
          actorUserId: ctx.actor().id,
        });
        return {
          source: await dtoForRow(ctx.app.governance, created.source, input.organizationId),
          ingestSecret: created.ingestSecret,
        };
      }),

      update: manage(updateSchema).mutation(async ({ ctx, input }) => {
        const updated = await ctx.app.governance.ingestionSourceUpdate({
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
        return dtoForRow(ctx.app.governance, updated, input.organizationId);
      }),

      /**
       * Mint a new ingest secret and retain the old hash for a 24h grace
       * window. Returns the new secret EXACTLY ONCE.
       */
      rotateSecret: manage(idAndOrg).mutation(async ({ ctx, input }) => {
        const rotated = await ctx.app.governance.ingestionSourceRotateSecret({
          id: input.id,
          organizationId: input.organizationId,
        });
        return {
          source: await dtoForRow(ctx.app.governance, rotated.source, input.organizationId),
          ingestSecret: rotated.ingestSecret,
        };
      }),

      archive: manage(idAndOrg).mutation(async ({ ctx, input }) => {
        const archived = await ctx.app.governance.ingestionSourceArchive({
          id: input.id,
          organizationId: input.organizationId,
        });
        return dtoForRow(ctx.app.governance, archived, input.organizationId);
      }),

      /**
       * Canonical OTTL starter statements for a source type, plus whether
       * OTTL editing is enabled for it. Pure function over a constant, but
       * exposed via tRPC so the catalog stays a single source of truth and
       * an admin-curated set can replace the starter map without a client
       * redeploy.
       */
      ottlStarter: view(ottlStarterSchema).query(({ input }) => ({
        enabled: isOttlEnabledSourceType(input.sourceType),
        statements: [...getStarterTemplate(input.sourceType)],
        enabledSourceTypes: [...OTTL_ENABLED_SOURCE_TYPES],
      })),

      /**
       * Validate a list of OTTL statements via the aigateway. The gateway
       * embeds `pkg/ottl` from the OpenTelemetry Collector and parses each
       * statement; on parse / type errors, returns per-statement coordinates
       * so the editor can surface line/column error markers.
       *
       * When `LW_GATEWAY_BASE_URL` is unset (dev fast-path) or the gateway is
       * up but does not yet ship the endpoint, the client returns
       * `{ status: "deferred" }` — the composer never blocks on infra, and
       * the editor renders neutral dots plus a note rather than claiming a
       * pass for statements nothing looked at. A hard network failure
       * degrades to "unknown" with a trace id via the plain re-throw here,
       * because a gateway outage is not something the caller can act on.
       */
      validateOttl: manage(validateOttlSchema).mutation(async ({ ctx, input }) =>
        ctx.app.governance.ottlValidate(input.statements),
      ),
    });
  }
}
