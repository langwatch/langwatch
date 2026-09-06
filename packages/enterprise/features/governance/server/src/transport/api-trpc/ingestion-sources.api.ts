/**
 * IngestionSource admin CRUD tRPC surface. Reads gate on `ingestionSources:view`, writes on
 * `ingestionSources:manage` — MEMBER and EXTERNAL roles never see the surface.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  GOVERNANCE_INGESTION_SOURCE_TYPES,
  ingestionSourceDtoSchema,
  ingestionSourceWithSecretSchema,
  ottlStarterTemplateSchema,
  ottlValidationResultSchema,
  getStarterTemplate,
  isOttlEnabledSourceType,
  OTTL_ENABLED_SOURCE_TYPES,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { IngestionSourceService } from "../../services/ingestion-source.service.ts";

export type IngestionSourcesTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
  actor(): Readonly<{ id: string }>;
}>;

type IngestionSourcesTrpcProcedures<
  TContext extends IngestionSourcesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
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
 * Strip the secret hash, private rotation slot and sealed credentials envelope before
 * serialising over the wire. See file docblock for why the envelope in particular must not
 * travel.
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
    hasPollerCursor: IngestionSourceService.hasPollerCursor(row.pollerCursor),
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
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(organizationScope)
          .withOutput(ingestionSourceDtoSchema.array())
          .withPermission("ingestionSources:view")
          /** The configured sources of one organization. */
          .handle(async ({ ctx, input }) => {
            const rows = await ctx.app.governance.ingestionSourceList(input.organizationId);
            // One destination query for the whole page rather than one per row.
            const liveTraceProjectIds = await ctx.app.governance.ingestionSourceLiveTraceProjectIds(
              rows,
              input.organizationId,
            );
            return rows.map((row) => toIngestionSourceDto({ row, liveTraceProjectIds }));
          }),
      )
      .query("get", (p) =>
        p
          .withInput(idAndOrg)
          .withOutput(ingestionSourceDtoSchema)
          .withPermission("ingestionSources:view")
          /** One source by id, scoped to the organization. */
          .handle(async ({ ctx, input }) => {
            const row = await ctx.app.governance.ingestionSourceGetById({
              id: input.id,
              organizationId: input.organizationId,
            });
            return dtoForRow(ctx.app.governance, row, input.organizationId);
          }),
      )
      .mutation("create", (p) =>
        p
          .withInput(createSchema)
          .withOutput(ingestionSourceWithSecretSchema)
          .withPermission("ingestionSources:manage")
          /**
           * A new IngestionSource. Answers the freshly-minted ingest secret
           * EXACTLY ONCE — the screen must show it to the admin before
           * navigating away, after which it is unrecoverable.
           */
          .handle(async ({ ctx, input }) => {
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
      )
      .mutation("update", (p) =>
        p
          .withInput(updateSchema)
          .withOutput(ingestionSourceDtoSchema)
          .withPermission("ingestionSources:manage")
          .handle(async ({ ctx, input }) => {
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
      )
      .mutation("rotateSecret", (p) =>
        p
          .withInput(idAndOrg)
          .withOutput(ingestionSourceWithSecretSchema)
          .withPermission("ingestionSources:manage")
          /**
           * Mints a new ingest secret and keeps the old hash for a 24-hour
           * grace window. Answers the new secret EXACTLY ONCE.
           */
          .handle(async ({ ctx, input }) => {
            const rotated = await ctx.app.governance.ingestionSourceRotateSecret({
              id: input.id,
              organizationId: input.organizationId,
            });
            return {
              source: await dtoForRow(ctx.app.governance, rotated.source, input.organizationId),
              ingestSecret: rotated.ingestSecret,
            };
          }),
      )
      .mutation("archive", (p) =>
        p
          .withInput(idAndOrg)
          .withOutput(ingestionSourceDtoSchema)
          .withPermission("ingestionSources:manage")
          .handle(async ({ ctx, input }) => {
            const archived = await ctx.app.governance.ingestionSourceArchive({
              id: input.id,
              organizationId: input.organizationId,
            });
            return dtoForRow(ctx.app.governance, archived, input.organizationId);
          }),
      )
      .query("ottlStarter", (p) =>
        p
          .withInput(ottlStarterSchema)
          .withOutput(ottlStarterTemplateSchema)
          .withPermission("ingestionSources:view")
          /**
           * The canonical OTTL starter statements for a source type, plus
           * whether OTTL editing is offered for it at all.
           */
          .handle(({ input }) => ({
            enabled: isOttlEnabledSourceType(input.sourceType),
            statements: [...getStarterTemplate(input.sourceType)],
            enabledSourceTypes: [...OTTL_ENABLED_SOURCE_TYPES],
          })),
      )
      .mutation("validateOttl", (p) =>
        p
          .withInput(validateOttlSchema)
          .withOutput(ottlValidationResultSchema)
          .withPermission("ingestionSources:manage")
          /**
           * Validates a list of OTTL statements through the AI gateway, which
           * embeds the OpenTelemetry Collector's `pkg/ottl` and parses each
           * statement. A parse or type error comes back with per-statement
           * coordinates, so the editor can mark the line and column.
           */
          .handle(async ({ ctx, input }) => ctx.app.governance.ottlValidate(input.statements)),
      )
      .build();
  }
}
