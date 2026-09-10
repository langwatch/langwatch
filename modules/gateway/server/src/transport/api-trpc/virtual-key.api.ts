/**
 * Virtual keys over tRPC, organization-scoped. Authorization is per-scope, data-dependent,
 * so it happens in the resolver. The plaintext key is returned only by create and rotate,
 * once at mint; every other procedure answers the DTO only.
 */
import { type Instant, nowInstant, Temporal, type TimeInput, toEpochMs } from "@langwatch/time";
/** The expiry a request carries, as the service reads it: absent, cleared, or a moment. */
function expiryInstant(value: TimeInput | null | undefined): Instant | null | undefined {
  return value === undefined || value === null
    ? value
    : Temporal.Instant.fromEpochMilliseconds(toEpochMs(value));
}

import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  virtualKeyApiApplicableBudgetsInputSchema,
  virtualKeyApiCreateInputSchema,
  virtualKeyApiDisableInputSchema,
  virtualKeyApiKeyInputSchema,
  virtualKeyApiOrganizationInputSchema,
  virtualKeyApiUpdateInputSchema,
  virtualKeyApplicableBudgetsSchema,
  virtualKeyCamelDtoSchema,
  virtualKeyMintedSchema,
  virtualKeySpendThisMonthSchema,
  GatewayWindow,
} from "@langwatch/gateway-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { GatewayActor, GatewayApp, GatewayVirtualKeyBudgetInput } from "#app/gateway.app";

/** The process supplies authentication; authorization arrives as the policies. */
export type VirtualKeyTrpcContext = Readonly<{
  /** The slice of the process's application this feature reaches; the tRPC root is shared. */
  app: Readonly<{ gateway: GatewayApp }>;
  actor(): Readonly<{ id: string }>;
  /** Opaque on purpose: what a session IS belongs to authentication, not this feature. */
  session: GatewayActor;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type VirtualKeyTrpcProcedures<
  TContext extends VirtualKeyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** For a scope set loaded at runtime. Applied after `.input()`, or it sees no input. */
  resolverAuthorizedPolicy(options: {
    reason: string;
    permissions: readonly AuthzPermission[];
  }): ProcedureDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/** Taken, not restated: a tRPC input parser is fixed at BUILD, while the app is per-request. */
export type VirtualKeyTrpcSchemas = Readonly<{
  virtualKeyBudgetInput: z.ZodType<GatewayVirtualKeyBudgetInput>;
}>;

/**
 * The reason every procedure here declares. Each one names the permissions its
 * resolver actually enforces, which is what keeps a per-scope decision
 * reviewable without pretending the transport could make it.
 */
const RESOLVER_AUTHORIZED =
  "the scopes a virtual key lives in are data the resolver loads, so the per-scope check happens there";

/** Installs the complete `virtualKeys.*` tRPC surface on a process root. */
export class VirtualKeyTrpcApi {
  static create<
    TContext extends VirtualKeyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: VirtualKeyTrpcProcedures<TContext, TOptions, TRoot>,
    schemas: VirtualKeyTrpcSchemas,
  ) {
    const { protected: procedure, resolverAuthorizedPolicy, validateOutput } = procedures;
    // The canonical budget parser the process injects, threaded into the two
    // contract schemas that accept a budget so the write path's decimal regex
    // and positive-amount refinement stay the one definition.
    const budgetInputSchema = schemas.virtualKeyBudgetInput;
    const createInputSchema = virtualKeyApiCreateInputSchema(budgetInputSchema);
    const updateInputSchema = virtualKeyApiUpdateInputSchema(budgetInputSchema);

    // Every procedure on this surface delegates its real check to the
    // resolver, via `resolverAuthorizedPolicy`. The chain's own `policy`
    // builder is never called; `withCustomPermission` carries the process's
    // ALREADY-BUILT decorator instead.
    const policy = (): ProcedureDecorator => {
      throw new Error(
        "virtualKeys declares a resolver-authorized check for every procedure; policy() is unused",
      );
    };

    return (
      createTrpcService({
        root: trpc,
        procedures: { protected: procedure, policy },
        validateOutput,
      })
        // Visibility is membership-based, not permission-based: a caller sees a
        // key when one of its scopes intersects their membership set, so a plain
        // organization member can list without a coarse organization-wide
        // `virtualKeys:view` grant they would not hold.
        .query("list", (p) =>
          p
            .withInput(virtualKeyApiOrganizationInputSchema)
            .withOutput(virtualKeyCamelDtoSchema.array())
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; only keys whose scopes intersect the caller's membership in this organization are returned`,
                permissions: ["virtualKeys:view"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              const keys = await ctx.app.gateway.listVisibleVirtualKeys({
                organizationId: input.organizationId,
                userId: ctx.actor().id,
              });
              return ctx.app.gateway.toVirtualKeyCamelDtos({ virtualKeys: keys });
            }),
        )
        .query("get", (p) =>
          p
            .withInput(virtualKeyApiKeyInputSchema)
            .withOutput(virtualKeyCamelDtoSchema)
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; the key must exist in this organization and intersect the caller's membership set, and a miss is answered as not found`,
                permissions: ["virtualKeys:view"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              // A key the caller can't see is indistinguishable from one that
              // doesn't exist — same NOT_FOUND, no existence leak.
              const vk = await ctx.app.gateway.requireVisibleVirtualKeyForUser({
                organizationId: input.organizationId,
                id: input.id,
                userId: ctx.actor().id,
              });
              return ctx.app.gateway.toVirtualKeyCamelDto(vk);
            }),
        )
        // Reads the same cost path the Usage tab does, so the table matches the linked page.
        .query("spendThisMonth", (p) =>
          p
            .withInput(virtualKeyApiOrganizationInputSchema)
            .withOutput(virtualKeySpendThisMonthSchema)
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; spend is reported only for keys visible to the caller's membership in this organization`,
                permissions: ["virtualKeys:view"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              // Without the ClickHouse spend source there is no number to report.
              // Failing loudly lets the column render "unavailable" instead of a
              // confident $0.00 that cannot be told apart from a zero-spend key.
              const spendRepo = ctx.app.gateway.getVirtualKeySpendService();
              if (!spendRepo) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: "spend_source_unavailable",
                });
              }
              const keys = await ctx.app.gateway.listVisibleVirtualKeys({
                organizationId: input.organizationId,
                userId: ctx.actor().id,
              });
              const now = nowInstant();
              const virtualKeyIds = keys.map((k) => k.id);
              const [spend, directBudgets] = await Promise.all([
                ctx.app.gateway.spendByVirtualKey({
                  organizationId: input.organizationId,
                  virtualKeyIds,
                  window: { fromDate: GatewayWindow.startOfCurrentMonthUTC(now), toDate: now },
                }),
                ctx.app.gateway.loadDirectBudgetsForKeys({
                  organizationId: input.organizationId,
                  virtualKeyIds,
                  now,
                }),
              ]);
              // Every visible key gets a row. With the spend source present, a
              // missing entry means the key genuinely spent nothing, so zero is
              // the honest render rather than an ambiguous blank.
              return keys.map((k) => ({
                virtualKeyId: k.id,
                spentUsd: spend.get(k.id)?.spentUsd ?? "0",
                requests: spend.get(k.id)?.requests ?? 0,
                budget: directBudgets.get(k.id) ?? null,
              }));
            }),
        )
        // Takes a draft (picked scopes, no key row yet) so the list is answerable pre-create.
        .query("applicableBudgets", (p) =>
          p
            .withInput(virtualKeyApiApplicableBudgetsInputSchema)
            .withOutput(virtualKeyApplicableBudgetsSchema)
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; for an existing key, its visibility in this organization, and for a draft, manage on every scope in it, both checked before any budget data is read`,
                permissions: ["virtualKeys:view", "virtualKeys:manage"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              // For an existing key, the caller must SEE it, and resolution binds to STORED
              // ownership; caller-supplied scopes/destination/principal are ignored, or an
              // org-wide key could leak a sibling's data.
              if (input.virtualKeyId) {
                const vk = await ctx.app.gateway.requireVisibleVirtualKeyForUser({
                  organizationId: input.organizationId,
                  id: input.virtualKeyId,
                  userId: ctx.actor().id,
                });
                return ctx.app.gateway.listApplicableBudgets({
                  target: {
                    organizationId: input.organizationId,
                    virtualKeyId: vk.id,
                    scopes: vk.scopes.map((scope) => ({
                      scopeType: scope.scopeType,
                      scopeId: scope.scopeId,
                    })),
                    traceProjectId: vk.traceProjectId,
                    principalUserId: vk.principalUserId,
                  },
                });
              }
              // For a draft (create drawer): the caller must hold
              // `virtualKeys:manage` on every draft scope AND on the chosen trace
              // destination — the exact boundary `create` will hold them to when they
              // submit. Previewing a target's budgets must not be cheaper than
              // creating a key against it.
              await ctx.app.gateway.authorizeVirtualKeyScopeSelection({
                actor: ctx.session,
                organizationId: input.organizationId,
                scopes: input.scopes,
                traceProjectId: input.traceProjectId,
              });
              // The principal id is still pinned to the organization: even an
              // authorized caller must not resolve another tenant's rows.
              if (input.principalUserId) {
                const member = await ctx.app.gateway.isOrganizationMember({
                  organizationId: input.organizationId,
                  userId: input.principalUserId,
                });
                if (!member) {
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "principalUserId is not a member of this organization.",
                  });
                }
              }
              return ctx.app.gateway.listApplicableBudgets({
                target: {
                  organizationId: input.organizationId,
                  virtualKeyId: null,
                  scopes: input.scopes,
                  traceProjectId: input.traceProjectId ?? null,
                  principalUserId: input.principalUserId ?? null,
                },
              });
            }),
        )
        .mutation("create", (p) =>
          p
            .withInput(createInputSchema)
            .withOutput(virtualKeyMintedSchema)
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; manage on every requested scope, and every scope anchored to this organization, both before the key is minted`,
                permissions: ["virtualKeys:manage"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              const actorUserId = ctx.actor().id;
              // The same pre-flight the public REST create runs: manage at every
              // requested scope, scopes inside the caller's organization, the
              // destination anchored and manageable, guardrail refs project-local.
              await ctx.app.gateway.authorizeVirtualKeyCreate({
                actor: ctx.session,
                organizationId: input.organizationId,
                scopes: input.scopes,
                traceProjectId: input.traceProjectId,
                guardrailAttachments: input.config?.guardrailAttachments,
              });
              const { virtualKey, secret } = await ctx.app.gateway.createVirtualKey({
                organizationId: input.organizationId,
                name: input.name,
                description: input.description ?? null,
                principalUserId: input.principalUserId ?? null,
                scopes: input.scopes,
                traceProjectId: input.traceProjectId ?? null,
                routingPolicyId: input.routingPolicyId ?? null,
                routingMode: input.routingMode,
                expiresAt: expiryInstant(input.expiresAt) ?? null,
                budget: input.budget ?? null,
                config: input.config,
                actorUserId,
              });
              // The one moment the plaintext key exists on the wire.
              return { virtualKey: await ctx.app.gateway.toVirtualKeyCamelDto(virtualKey), secret };
            }),
        )
        .mutation("update", (p) =>
          p
            .withInput(updateInputSchema)
            .withOutput(virtualKeyCamelDtoSchema)
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes, plus manage on every new scope when re-scoping`,
                permissions: ["virtualKeys:update", "virtualKeys:manage"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              const actorUserId = ctx.actor().id;
              // The same pre-flight the public REST patch runs: update on a scope the
              // key already lives in, manage on every new scope when re-scoping, the
              // destination anchored and manageable when it moves, and the guardrail
              // attachments judged against the project the key resolves to.
              await ctx.app.gateway.authorizeVirtualKeyUpdate({
                actor: ctx.session,
                organizationId: input.organizationId,
                id: input.id,
                scopes: input.scopes,
                traceProjectId: input.traceProjectId,
                guardrailAttachments: input.config?.guardrailAttachments,
              });
              const updated = await ctx.app.gateway.updateVirtualKey({
                id: input.id,
                organizationId: input.organizationId,
                name: input.name,
                description: input.description,
                scopes: input.scopes,
                traceProjectId: input.traceProjectId,
                routingPolicyId: input.routingPolicyId,
                routingMode: input.routingMode,
                expiresAt: expiryInstant(input.expiresAt),
                budget: input.budget,
                config: input.config,
                actorUserId,
              });
              return ctx.app.gateway.toVirtualKeyCamelDto(updated);
            }),
        )
        .mutation("rotate", (p) =>
          p
            .withInput(virtualKeyApiKeyInputSchema)
            .withOutput(virtualKeyMintedSchema)
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; rotate on one of the key's existing scopes`,
                permissions: ["virtualKeys:rotate"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              const actorUserId = ctx.actor().id;
              await ctx.app.gateway.authorizeVirtualKeyOperation({
                actor: ctx.session,
                organizationId: input.organizationId,
                id: input.id,
                permission: "virtualKeys:rotate",
              });
              const { virtualKey, secret } = await ctx.app.gateway.rotateVirtualKey({
                id: input.id,
                organizationId: input.organizationId,
                actorUserId,
              });
              // The second and last moment the plaintext key exists on the wire.
              return { virtualKey: await ctx.app.gateway.toVirtualKeyCamelDto(virtualKey), secret };
            }),
        )
        .mutation("revoke", (p) =>
          p
            .withInput(virtualKeyApiKeyInputSchema)
            .withOutput(virtualKeyCamelDtoSchema)
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; delete on one of the key's existing scopes`,
                permissions: ["virtualKeys:delete"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              const actorUserId = ctx.actor().id;
              await ctx.app.gateway.authorizeVirtualKeyOperation({
                actor: ctx.session,
                organizationId: input.organizationId,
                id: input.id,
                permission: "virtualKeys:delete",
              });
              const updated = await ctx.app.gateway.revokeVirtualKey({
                id: input.id,
                organizationId: input.organizationId,
                actorUserId,
              });
              return ctx.app.gateway.toVirtualKeyCamelDto(updated);
            }),
        )
        .mutation("disable", (p) =>
          p
            .withInput(virtualKeyApiDisableInputSchema)
            .withOutput(virtualKeyCamelDtoSchema)
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes`,
                permissions: ["virtualKeys:update"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              const actorUserId = ctx.actor().id;
              await ctx.app.gateway.authorizeVirtualKeyOperation({
                actor: ctx.session,
                organizationId: input.organizationId,
                id: input.id,
                permission: "virtualKeys:update",
              });
              const updated = await ctx.app.gateway.disableVirtualKey({
                id: input.id,
                organizationId: input.organizationId,
                actorUserId,
                reason: input.reason ?? null,
              });
              return ctx.app.gateway.toVirtualKeyCamelDto(updated);
            }),
        )
        .mutation("enable", (p) =>
          p
            .withInput(virtualKeyApiKeyInputSchema)
            .withOutput(virtualKeyCamelDtoSchema)
            .withCustomPermission(
              resolverAuthorizedPolicy({
                reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes`,
                permissions: ["virtualKeys:update"],
              }),
              RESOLVER_AUTHORIZED,
            )
            .handle(async ({ ctx, input }) => {
              const actorUserId = ctx.actor().id;
              await ctx.app.gateway.authorizeVirtualKeyOperation({
                actor: ctx.session,
                organizationId: input.organizationId,
                id: input.id,
                permission: "virtualKeys:update",
              });
              const updated = await ctx.app.gateway.enableVirtualKey({
                id: input.id,
                organizationId: input.organizationId,
                actorUserId,
              });
              return ctx.app.gateway.toVirtualKeyCamelDto(updated);
            }),
        )
        .build()
    );
  }
}
