/**
 * Virtual keys over tRPC, organization-scoped (every procedure takes organizationId). Authorization is per-scope, not org-wide: create needs virtualKeys:manage on EVERY requested scope, mutating needs the operation's permission on AT LEAST ONE scope the key already lives in — data-dependent, so it happens in the resolver, declared here by name. Visibility is separate: a caller SEES a key when one of its scopes intersects their membership set (a plain member can list without virtualKeys:view); an unseen key answers as nonexistent. The plaintext key is returned by exactly create and rotate, exactly once at mint, never as an audited argument — every other procedure answers the DTO (displayPrefix, no secret material). Transport only: per-scope authorization, DTO projection and budget resolvers are the application's, shared with the public REST door.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  virtualKeyApiApplicableBudgetsInputSchema,
  virtualKeyApiCreateInputSchema,
  virtualKeyApiDisableInputSchema,
  virtualKeyApiKeyInputSchema,
  virtualKeyApiOrganizationInputSchema,
  virtualKeyApiUpdateInputSchema,
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
  /**
   * The slice of the process's application this feature reaches, not the feature's application itself — a tRPC root is shared by every mounted feature. The REST family, built per process, holds {@link GatewayApp} directly.
   */
  app: Readonly<{ gateway: GatewayApp }>;
  actor(): Readonly<{ id: string }>;
  /**
   * The process's authenticated principal, carried straight back into the application's per-scope checks. Opaque on purpose — a principal here is a browser session, and what a session IS belongs to the process's authentication, not this feature; the transport only hands it on.
   */
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
  /**
   * Declaration for a procedure whose scope set is data the resolver loads at runtime, so the resolver performs the real check (records why + which permissions). Applied AFTER this feature's input parser, not composed ahead of it — tRPC appends input middleware at .input()'s call site and runs in add order, so an earlier policy would see input === undefined and the audit row would land with no arguments.
   */
  resolverAuthorizedPolicy(options: {
    reason: string;
    permissions: readonly AuthzPermission[];
  }): ProcedureDecorator;
}>;

/**
 * The canonical budget parser, taken rather than restated — its decimal regex and positive-amount refinement are the write path's contract and must not drift from a second copy. An argument rather than read off {@link GatewayApp} since a tRPC input parser is fixed when the router is BUILT while the application is per-request; REST reaches the same parser via app.schemas at request time.
 */
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
    const { protected: procedure, resolverAuthorizedPolicy } = procedures;
    // The canonical budget parser the process injects, threaded into the two
    // contract schemas that accept a budget so the write path's decimal regex
    // and positive-amount refinement stay the one definition.
    const budgetInputSchema = schemas.virtualKeyBudgetInput;
    const createInputSchema = virtualKeyApiCreateInputSchema(budgetInputSchema);
    const updateInputSchema = virtualKeyApiUpdateInputSchema(budgetInputSchema);

    return trpc.router({
      // Visibility is membership-based, not permission-based: a caller sees a
      // key when one of its scopes intersects their membership set, so a plain
      // organization member can list without a coarse organization-wide
      // `virtualKeys:view` grant they would not hold.
      list: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; only keys whose scopes intersect the caller's membership in this organization are returned`,
        permissions: ["virtualKeys:view"],
      })(procedure.input(virtualKeyApiOrganizationInputSchema)).query(async ({ ctx, input }) => {
        const keys = await ctx.app.gateway.listVisibleVirtualKeys({
          organizationId: input.organizationId,
          userId: ctx.actor().id,
        });
        return ctx.app.gateway.toVirtualKeyCamelDtos({ virtualKeys: keys });
      }),

      get: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; the key must exist in this organization and intersect the caller's membership set, and a miss is answered as not found`,
        permissions: ["virtualKeys:view"],
      })(procedure.input(virtualKeyApiKeyInputSchema)).query(async ({ ctx, input }) => {
        // A key the caller can't see is indistinguishable from one that
        // doesn't exist — same NOT_FOUND, no existence leak.
        const vk = await ctx.app.gateway.requireVisibleVirtualKeyForUser({
          organizationId: input.organizationId,
          id: input.id,
          userId: ctx.actor().id,
        });
        return ctx.app.gateway.toVirtualKeyCamelDto(vk);
      }),

      /**
       * Spend per key this calendar month, for keys the caller can see — reads the cost path, the same source the Usage tab reads, so the table number matches the page a click lands on. Keys with their own budget also get its limit + CURRENT-PERIOD spend (a different measurement from the month total, e.g. a daily cap), both in this one batched call so the table never asks per row.
       */
      spendThisMonth: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; spend is reported only for keys visible to the caller's membership in this organization`,
        permissions: ["virtualKeys:view"],
      })(procedure.input(virtualKeyApiOrganizationInputSchema)).query(async ({ ctx, input }) => {
        // Without the ClickHouse spend source there is no number to report.
        // Failing loudly lets the column render "unavailable" instead of a
        // confident $0.00 that cannot be told apart from a zero-spend key.
        const spendRepo = ctx.app.gateway.virtualKeySpend;
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
        const now = new Date();
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

      /**
       * Every budget that would constrain this key: the "already applies" list under the budget field in create/edit drawers. Takes a draft (picked scopes, no key row yet) so the list is answerable before the key exists.
       */
      applicableBudgets: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; for an existing key, its visibility in this organization, and for a draft, manage on every scope in it, both checked before any budget data is read`,
        permissions: ["virtualKeys:view", "virtualKeys:manage"],
      })(procedure.input(virtualKeyApiApplicableBudgetsInputSchema)).query(
        async ({ ctx, input }) => {
          // Authorization first — this resolver answers budget names, limits,
          // live spend and (for a principal) their name, so an org id alone
          // must not be enough. For an existing key, the caller must SEE it,
          // and resolution binds to STORED ownership; caller-supplied scopes/
          // destination/principal are ignored, or a visible org-wide key could leak a sibling's data.
          if (input.virtualKeyId) {
            const vk = await ctx.app.gateway.requireVisibleVirtualKeyForUser({
              organizationId: input.organizationId,
              id: input.virtualKeyId,
              userId: ctx.actor().id,
            });
            return ctx.app.gateway.resolveApplicableBudgets({
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
          return ctx.app.gateway.resolveApplicableBudgets({
            target: {
              organizationId: input.organizationId,
              virtualKeyId: null,
              scopes: input.scopes,
              traceProjectId: input.traceProjectId ?? null,
              principalUserId: input.principalUserId ?? null,
            },
          });
        },
      ),

      create: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; manage on every requested scope, and every scope anchored to this organization, both before the key is minted`,
        permissions: ["virtualKeys:manage"],
      })(procedure.input(createInputSchema)).mutation(async ({ ctx, input }) => {
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
        const { virtualKey, secret } = await ctx.app.gateway.virtualKeys.create({
          organizationId: input.organizationId,
          name: input.name,
          description: input.description ?? null,
          principalUserId: input.principalUserId ?? null,
          scopes: input.scopes,
          traceProjectId: input.traceProjectId ?? null,
          routingPolicyId: input.routingPolicyId ?? null,
          routingMode: input.routingMode,
          expiresAt: input.expiresAt ?? null,
          budget: input.budget ?? null,
          config: input.config,
          actorUserId,
        });
        // The one moment the plaintext key exists on the wire.
        return { virtualKey: await ctx.app.gateway.toVirtualKeyCamelDto(virtualKey), secret };
      }),

      update: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes, plus manage on every new scope when re-scoping`,
        permissions: ["virtualKeys:update", "virtualKeys:manage"],
      })(procedure.input(updateInputSchema)).mutation(async ({ ctx, input }) => {
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
        const updated = await ctx.app.gateway.virtualKeys.update({
          id: input.id,
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          scopes: input.scopes,
          traceProjectId: input.traceProjectId,
          routingPolicyId: input.routingPolicyId,
          routingMode: input.routingMode,
          expiresAt: input.expiresAt,
          budget: input.budget,
          config: input.config,
          actorUserId,
        });
        return ctx.app.gateway.toVirtualKeyCamelDto(updated);
      }),

      rotate: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; rotate on one of the key's existing scopes`,
        permissions: ["virtualKeys:rotate"],
      })(procedure.input(virtualKeyApiKeyInputSchema)).mutation(async ({ ctx, input }) => {
        const actorUserId = ctx.actor().id;
        await ctx.app.gateway.authorizeVirtualKeyOperation({
          actor: ctx.session,
          organizationId: input.organizationId,
          id: input.id,
          permission: "virtualKeys:rotate",
        });
        const { virtualKey, secret } = await ctx.app.gateway.virtualKeys.rotate({
          id: input.id,
          organizationId: input.organizationId,
          actorUserId,
        });
        // The second and last moment the plaintext key exists on the wire.
        return { virtualKey: await ctx.app.gateway.toVirtualKeyCamelDto(virtualKey), secret };
      }),

      revoke: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; delete on one of the key's existing scopes`,
        permissions: ["virtualKeys:delete"],
      })(procedure.input(virtualKeyApiKeyInputSchema)).mutation(async ({ ctx, input }) => {
        const actorUserId = ctx.actor().id;
        await ctx.app.gateway.authorizeVirtualKeyOperation({
          actor: ctx.session,
          organizationId: input.organizationId,
          id: input.id,
          permission: "virtualKeys:delete",
        });
        const updated = await ctx.app.gateway.virtualKeys.revoke({
          id: input.id,
          organizationId: input.organizationId,
          actorUserId,
        });
        return ctx.app.gateway.toVirtualKeyCamelDto(updated);
      }),

      disable: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes`,
        permissions: ["virtualKeys:update"],
      })(procedure.input(virtualKeyApiDisableInputSchema)).mutation(async ({ ctx, input }) => {
        const actorUserId = ctx.actor().id;
        await ctx.app.gateway.authorizeVirtualKeyOperation({
          actor: ctx.session,
          organizationId: input.organizationId,
          id: input.id,
          permission: "virtualKeys:update",
        });
        const updated = await ctx.app.gateway.virtualKeys.disable({
          id: input.id,
          organizationId: input.organizationId,
          actorUserId,
          reason: input.reason ?? null,
        });
        return ctx.app.gateway.toVirtualKeyCamelDto(updated);
      }),

      enable: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes`,
        permissions: ["virtualKeys:update"],
      })(procedure.input(virtualKeyApiKeyInputSchema)).mutation(async ({ ctx, input }) => {
        const actorUserId = ctx.actor().id;
        await ctx.app.gateway.authorizeVirtualKeyOperation({
          actor: ctx.session,
          organizationId: input.organizationId,
          id: input.id,
          permission: "virtualKeys:update",
        });
        const updated = await ctx.app.gateway.virtualKeys.enable({
          id: input.id,
          organizationId: input.organizationId,
          actorUserId,
        });
        return ctx.app.gateway.toVirtualKeyCamelDto(updated);
      }),
    });
  }
}
