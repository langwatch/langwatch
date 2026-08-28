/**
 * Gateway cache-control rules over the process's tRPC transport.
 *
 * Every procedure is organization-scoped. The rule bundle reaches the gateway
 * through the config materialiser, not through here; this is the platform UI
 * and CLI surface for the rules themselves.
 *
 * Transport only: input parsing, the wire DTO, and delegation to the process's
 * cache-rule capability, which arrives as a port because it is built over
 * persistence this transport does not hold.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { GatewayCacheRule } from "@langwatch/prisma-client/generated";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/** The process supplies authentication; authorization arrives as `policy`. */
export type GatewayCacheRuleTrpcContext = Readonly<{
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

type Matchers = z.infer<typeof matchersSchema>;
type Action = z.infer<typeof actionSchema>;

/**
 * The cache-rule operations this transport calls, exactly as the process's
 * cache-rule service exposes them.
 */
export type GatewayCacheRuleOperations = Readonly<{
  list(organizationId: string): Promise<GatewayCacheRule[]>;
  get(id: string, organizationId: string): Promise<GatewayCacheRule | null>;
  create(input: {
    organizationId: string;
    name: string;
    description: string | null;
    priority?: number;
    enabled?: boolean;
    matchers: Matchers;
    action: Action;
    actorUserId: string;
  }): Promise<GatewayCacheRule>;
  update(input: {
    id: string;
    organizationId: string;
    name?: string;
    description?: string | null;
    priority?: number;
    enabled?: boolean;
    matchers?: Matchers;
    action?: Action;
    actorUserId: string;
  }): Promise<GatewayCacheRule>;
  archive(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<GatewayCacheRule>;
}>;

export type GatewayCacheRuleTrpcPorts = Readonly<{
  /**
   * Refuses an organization id that names no organization, with the same
   * NOT_FOUND this surface has always answered. A tenancy anchor, not an
   * authorization check.
   */
  assertOrganizationExists(organizationId: string): Promise<void>;
  /** The process's cache-rule capability, built over its own persistence. */
  cacheRules(): GatewayCacheRuleOperations;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });
const cacheRuleIdSchema = z.object({ organizationId: z.string(), id: z.string() });

function toDto(r: GatewayCacheRule) {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    description: r.description,
    priority: r.priority,
    enabled: r.enabled,
    matchers: r.matchers,
    action: r.action,
    modeEnum: r.modeEnum,
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
    TPorts extends GatewayCacheRuleTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GatewayCacheRuleTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      list: policy("gatewayCacheRules:view")(procedure.input(organizationScopeSchema)).query(
        async ({ input }) => {
          await ports.assertOrganizationExists(input.organizationId);
          const rows = await ports.cacheRules().list(input.organizationId);
          return rows.map(toDto);
        },
      ),

      get: policy("gatewayCacheRules:view")(procedure.input(cacheRuleIdSchema)).query(
        async ({ input }) => {
          await ports.assertOrganizationExists(input.organizationId);
          const row = await ports.cacheRules().get(input.id, input.organizationId);
          if (!row) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "cache rule not found",
            });
          }
          return toDto(row);
        },
      ),

      create: policy("gatewayCacheRules:create")(
        procedure.input(
          z.object({
            organizationId: z.string(),
            name: z.string().min(1).max(128),
            description: z.string().max(512).nullable().optional(),
            priority: z.number().int().min(0).max(1_000).optional(),
            enabled: z.boolean().optional(),
            matchers: matchersSchema,
            action: actionSchema,
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        await ports.assertOrganizationExists(input.organizationId);
        const row = await ports.cacheRules().create({
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

      update: policy("gatewayCacheRules:update")(
        procedure.input(
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
        ),
      ).mutation(async ({ ctx, input }) => {
        await ports.assertOrganizationExists(input.organizationId);
        const row = await ports.cacheRules().update({
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

      archive: policy("gatewayCacheRules:delete")(procedure.input(cacheRuleIdSchema)).mutation(
        async ({ ctx, input }) => {
          await ports.assertOrganizationExists(input.organizationId);
          const row = await ports.cacheRules().archive({
            id: input.id,
            organizationId: input.organizationId,
            actorUserId: ctx.actor().id,
          });
          return toDto(row);
        },
      ),
    });
  }
}
