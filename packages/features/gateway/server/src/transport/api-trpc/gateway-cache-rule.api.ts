/**
 * Gateway cache-control rules over the process's tRPC transport.
 *
 * Every procedure is organization-scoped. The rule bundle reaches the gateway
 * through the config materialiser, not through here; this is the platform UI
 * and CLI surface for the rules themselves.
 *
 * Transport only: input parsing, the wire DTO, and delegation to the feature's
 * application, which holds the cache-rule capability because it is built over
 * persistence this transport does not hold.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  gatewayCacheRuleDtoSchema,
  GatewayCacheRuleNotFoundError,
  type GatewayCacheRuleResource,
} from "@langwatch/gateway-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { GatewayApp } from "#app/gateway.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not the
 * feature's application itself, because a tRPC root is shared by every feature
 * mounted on it and so carries all of them. The REST family, built per process,
 * holds {@link GatewayApp} directly.
 */
export type GatewayCacheRuleTrpcContext = Readonly<{
  app: Readonly<{ gateway: GatewayApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type GatewayCacheRuleTrpcProcedures<
  TContext extends GatewayCacheRuleTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Tracing, logging, error shaping, scope lineage, the check, and audit,
   * applied AFTER this feature's input parser: a check installed before
   * `.input()` would read no input, and so no scope id, at all.
   */
  policy(permission: AuthzPermission): ProcedureDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

const matchersSchema = z
  .object({
    vk_id: z.string().optional(),
    vk_tags: z.array(z.string()).optional(),
    vk_prefix: z.string().optional(),
    principal_id: z.string().optional(),
    model: z.string().optional(),
    request_metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const actionSchema = z
  .object({
    mode: z.enum(["respect", "force", "disable"]),
    ttl: z.number().int().min(0).max(86_400).optional(),
    salt: z.string().max(64).optional(),
  })
  .strict();

const organizationScopeSchema = z.object({ organizationId: z.string() });
const cacheRuleIdSchema = z.object({ organizationId: z.string(), id: z.string() });

/**
 * The wire row, unchanged: `modeEnum` keeps its name because the browser and
 * the CLI read it, even though the canonical resource calls the field `mode`.
 */
function toDto(r: GatewayCacheRuleResource) {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    description: r.description,
    priority: r.priority,
    enabled: r.enabled,
    matchers: r.matchers,
    action: r.action,
    modeEnum: r.mode,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Installs the complete `gatewayCacheRules.*` tRPC surface on a process root. */
export class GatewayCacheRuleTrpcApi {
  static create<
    TContext extends GatewayCacheRuleTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GatewayCacheRuleTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(organizationScopeSchema)
          .withOutput(gatewayCacheRuleDtoSchema.array())
          .withPermission("gatewayCacheRules:view")
          .handle(async ({ ctx, input }) => {
            await ctx.app.gateway.assertOrganizationExists(input.organizationId);
            const rows = await ctx.app.gateway.budgetDecisions.cacheRuleList(input.organizationId);
            return rows.map(toDto);
          }),
      )
      .query("get", (p) =>
        p
          .withInput(cacheRuleIdSchema)
          .withOutput(gatewayCacheRuleDtoSchema)
          .withPermission("gatewayCacheRules:view")
          .handle(async ({ ctx, input }) => {
            await ctx.app.gateway.assertOrganizationExists(input.organizationId);
            const row = await ctx.app.gateway.budgetDecisions.tryCacheRuleGet({
              id: input.id,
              organizationId: input.organizationId,
            });
            if (!row) {
              throw new GatewayCacheRuleNotFoundError();
            }
            return toDto(row);
          }),
      )
      .mutation("create", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              name: z.string().min(1).max(128),
              description: z.string().max(512).nullable().optional(),
              priority: z.number().int().min(0).max(1_000).optional(),
              enabled: z.boolean().optional(),
              matchers: matchersSchema,
              action: actionSchema,
            }),
          )
          .withOutput(gatewayCacheRuleDtoSchema)
          .withPermission("gatewayCacheRules:create")
          .handle(async ({ ctx, input }) => {
            await ctx.app.gateway.assertOrganizationExists(input.organizationId);
            const row = await ctx.app.gateway.budgetDecisions.cacheRuleCreate({
              organizationId: input.organizationId,
              name: input.name,
              description: input.description ?? null,
              priority: input.priority,
              enabled: input.enabled,
              matchers: input.matchers,
              action: input.action,
              actorUserId: ctx.actor().id,
            });
            return toDto(row);
          }),
      )
      .mutation("update", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              id: z.string(),
              name: z.string().min(1).max(128).optional(),
              description: z.string().max(512).nullable().optional(),
              priority: z.number().int().min(0).max(1_000).optional(),
              enabled: z.boolean().optional(),
              matchers: matchersSchema.optional(),
              action: actionSchema.optional(),
            }),
          )
          .withOutput(gatewayCacheRuleDtoSchema)
          .withPermission("gatewayCacheRules:update")
          .handle(async ({ ctx, input }) => {
            await ctx.app.gateway.assertOrganizationExists(input.organizationId);
            const row = await ctx.app.gateway.budgetDecisions.cacheRuleUpdate({
              id: input.id,
              organizationId: input.organizationId,
              name: input.name,
              description: input.description,
              priority: input.priority,
              enabled: input.enabled,
              matchers: input.matchers,
              action: input.action,
              actorUserId: ctx.actor().id,
            });
            return toDto(row);
          }),
      )
      .mutation("archive", (p) =>
        p
          .withInput(cacheRuleIdSchema)
          .withOutput(gatewayCacheRuleDtoSchema)
          .withPermission("gatewayCacheRules:delete")
          .handle(async ({ ctx, input }) => {
            await ctx.app.gateway.assertOrganizationExists(input.organizationId);
            const row = await ctx.app.gateway.budgetDecisions.cacheRuleArchive({
              id: input.id,
              organizationId: input.organizationId,
              actorUserId: ctx.actor().id,
            });
            return toDto(row);
          }),
      )
      .build();
  }
}
