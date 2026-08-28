/**
 * Virtual keys over the process's tRPC transport.
 *
 * Organization-scoped: every procedure takes `organizationId` as the tenant
 * key. Which caller may do what is decided per scope rather than organization
 * wide — a key carries N (scopeType, scopeId) entries, and creating one needs
 * `virtualKeys:manage` on EVERY requested scope while mutating one needs the
 * operation's permission on AT LEAST ONE scope the key already lives in. That
 * decision is data-dependent, so it happens in the resolver and the
 * declarations here say so and name the permissions the resolver enforces.
 *
 * Visibility is a different rule again, and deliberately so: a caller SEES a
 * key when one of its scopes intersects their membership set, which is why a
 * plain organization member can list keys without holding `virtualKeys:view`.
 * A key they cannot see is answered as one that does not exist.
 *
 * ## Credentials
 *
 * The plaintext key is returned by exactly two procedures — `create` and
 * `rotate` — and exactly once, at the moment it is minted. Every other
 * procedure answers the DTO, which carries `displayPrefix` and no secret
 * material at all. The minted value is a RESPONSE, never an input, so it is
 * never among the arguments the process's audit middleware records.
 *
 * Reads return the camel-cased DTO: the `scopes[]` array plus `routingPolicyId`
 * carry the eligible-provider derivation, and the legacy
 * `providerCredentialIds` / `providerChain` fields are not surfaced.
 *
 * Transport only. The per-scope authorization helpers, the DTO projection and
 * the budget resolvers are built over persistence this transport does not hold,
 * so they arrive as ports.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  parseVirtualKeyConfig,
  virtualKeyConfigSchema,
  type GatewayService,
  type VirtualKeyConfig,
} from "@langwatch/gateway-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import { startOfCurrentMonthUTC } from "../../repositories/clickhouse/clickhouse.gateway-virtual-key-spend.repository";
import type { GatewayBudgetSpendPort } from "../../ports/gateway-budget-spend.port";
import type { GatewayVirtualKeySpendPort } from "../../ports/gateway-virtual-key-spend.port";
import type {
  GatewayVirtualKeyScope,
  VirtualKeyWithScopes,
} from "../../ports/gateway-virtual-key.port";

/**
 * The virtual-key WRITE capability this transport calls. Reads go through the
 * visibility ports below, because who may see a key is not the service's
 * decision.
 */
type VirtualKeyWrites = Readonly<{
  create(input: {
    organizationId: string;
    name: string;
    description?: string | null;
    principalUserId?: string | null;
    scopes: GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
    routingPolicyId?: string | null;
    routingMode?: "FALLBACK_ALL" | "NONE" | "POLICY";
    expiresAt?: Date | null;
    budget?: VirtualKeyBudgetInput | null;
    config?: Partial<VirtualKeyConfig>;
    actorUserId: string;
  }): Promise<{ virtualKey: VirtualKeyWithScopes; secret: string }>;
  update(input: {
    id: string;
    organizationId: string;
    name?: string;
    description?: string | null;
    scopes?: GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
    routingPolicyId?: string | null;
    routingMode?: "FALLBACK_ALL" | "NONE" | "POLICY";
    expiresAt?: Date | null;
    budget?: VirtualKeyBudgetInput | null;
    config?: Partial<VirtualKeyConfig>;
    actorUserId: string;
  }): Promise<VirtualKeyWithScopes>;
  rotate(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<{ virtualKey: VirtualKeyWithScopes; secret: string }>;
  revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<VirtualKeyWithScopes>;
  disable(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    reason: string | null;
  }): Promise<VirtualKeyWithScopes>;
  enable(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<VirtualKeyWithScopes>;
}>;

/**
 * The budget a key may carry of its own. The canonical parser is the process's
 * `virtualKeyBudgetInputSchema`, which arrives through `ports.schemas` so the
 * regex and the positive-amount refinement are never restated here; this type
 * is only what the transport hands back to the service.
 */
export type VirtualKeyBudgetInput = Readonly<{
  limitUsd: string;
  window: "DAY" | "WEEK" | "MONTH";
  onBreach?: "BLOCK" | "WARN";
  name?: string;
}>;

/** The read half, kept separate: who may SEE a key is not the service's call. */
type VirtualKeyReads = Readonly<{
  getAll(organizationId: string): Promise<VirtualKeyWithScopes[]>;
  getById(id: string, organizationId: string): Promise<VirtualKeyWithScopes | null>;
}>;

type VirtualKeyApplication = Readonly<{
  /** Resolves the projects a key's traces land in, for the wire projection. */
  projects: ProjectService;
  gateway: Readonly<{
    virtualKeys: VirtualKeyWrites & VirtualKeyReads;
    /** The budget-decision service the applicable-budget resolver reads. */
    budgetDecisions: GatewayService;
    budgets: GatewayBudgetSpendPort | undefined;
    /**
     * Absent on a deployment without the ClickHouse spend path. `spendThisMonth`
     * refuses rather than reporting a confident zero that cannot be told apart
     * from a key that genuinely spent nothing.
     */
    virtualKeySpend: GatewayVirtualKeySpendPort | undefined;
  }>;
}>;

/** The process supplies authentication; authorization arrives as the policies. */
export type VirtualKeyTrpcContext = Readonly<{
  app: VirtualKeyApplication;
  actor(): Readonly<{ id: string }>;
  /**
   * The process's authenticated principal, carried straight back into the
   * process's own per-scope checks below.
   *
   * Opaque on purpose: a principal here is a browser session, and what a
   * session IS belongs to the process's authentication, not to this feature.
   * The transport never reads it — it only hands it to the port that does.
   */
  session: ActorPrincipal;
}>;

/**
 * The process's authenticated principal. See `VirtualKeyTrpcContext.session`
 * for why it is opaque.
 */
type ActorPrincipal = unknown;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type VirtualKeyTrpcProcedures<
  TContext extends VirtualKeyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The declaration for a procedure whose scope set is data the resolver loads
   * at runtime, so the resolver performs the real check. Records why, and which
   * permissions it enforces.
   *
   * Applied AFTER this feature's input parser rather than composed ahead of it:
   * tRPC appends the input middleware where `.input()` is called and runs
   * middlewares in the order they were added, so a policy installed first would
   * see `input === undefined`, the lineage guard would compare nothing, and the
   * audit row would land with no arguments.
   */
  resolverAuthorizedPolicy(options: {
    reason: string;
    permissions: readonly AuthzPermission[];
  }): ProcedureDecorator;
}>;

/** A draft or existing key, as the applicable-budget resolver takes it. */
type ApplicableBudgetTarget = Readonly<{
  organizationId: string;
  virtualKeyId: string | null;
  scopes: readonly GatewayVirtualKeyScope[];
  traceProjectId: string | null;
  principalUserId: string | null;
}>;

/**
 * Everything this transport needs that is neither the key's own write service
 * nor decidable from the request alone.
 *
 * Consumed through a generic so the concrete DTO and budget shapes the process
 * wires in survive into the router's inferred output types rather than
 * collapsing to the loose constraint named here.
 */
export type VirtualKeyTrpcPorts = Readonly<{
  /**
   * The organization's keys, narrowed to the ones this caller can see.
   * Membership-based: an organization member sees organization-scoped keys, a
   * team member sees that team's keys.
   */
  listVisibleVirtualKeys(input: {
    organizationId: string;
    userId: string;
    virtualKeys: VirtualKeyReads;
  }): Promise<VirtualKeyWithScopes[]>;
  /**
   * One key for a by-id READ, under the list's visibility rule: a key outside
   * the caller's membership set is indistinguishable from one that does not
   * exist. Mutations deliberately do NOT use this — their contract is
   * permission-based, so a scope role-binding holder can operate without being
   * a member and an unauthorized caller gets FORBIDDEN.
   */
  requireVisibleVirtualKey(input: {
    organizationId: string;
    id: string;
    userId: string;
    virtualKeys: VirtualKeyReads;
  }): Promise<VirtualKeyWithScopes>;
  /** One key anchored to this organization, without the visibility rule. */
  requireExistingVirtualKey(input: {
    organizationId: string;
    id: string;
    virtualKeys: VirtualKeyReads;
  }): Promise<VirtualKeyWithScopes>;
  /** `virtualKeys:manage` on EVERY named scope, fail-closed. */
  assertCanManageAllScopes(input: {
    principal: ActorPrincipal;
    scopes: readonly GatewayVirtualKeyScope[];
  }): Promise<void>;
  /** One named permission on AT LEAST ONE of the key's existing scopes. */
  assertCanOperateOnAnyScope(input: {
    principal: ActorPrincipal;
    scopes: readonly GatewayVirtualKeyScope[];
    permission: AuthzPermission;
  }): Promise<void>;
  /** Anchors every scope in the set to this organization. */
  assertScopesBelongToOrganization(input: {
    organizationId: string;
    scopes: readonly GatewayVirtualKeyScope[];
  }): Promise<void>;
  /** Anchors the trace destination to this organization. */
  assertTraceProjectBelongsToOrganization(input: {
    organizationId: string;
    traceProjectId: string | null | undefined;
  }): Promise<void>;
  /** Refuses a guardrail attachment the caller may not make in this project. */
  assertGuardrailAttachmentsAllowed(input: {
    principal: ActorPrincipal;
    projectId: string | null;
    attachments: unknown;
  }): Promise<void>;
  /** The project a key's guardrail attachments are judged against. */
  resolveVirtualKeyProjectId(input: {
    organizationId: string;
    virtualKeyId: string | null;
    scopes: readonly GatewayVirtualKeyScope[] | undefined;
    traceProjectId: string | null;
  }): Promise<string | null>;
  /** Whether a user belongs to this organization. */
  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean>;
  /**
   * The wire projection for a page of keys, in one read of the destinations
   * however large the page: a listing must not cost a query per key to say
   * where each one's traffic goes.
   */
  toVirtualKeyDtos(input: {
    virtualKeys: readonly VirtualKeyWithScopes[];
    projects: ProjectService;
  }): Promise<unknown[]>;
  /** Every budget that would constrain a draft or existing key. */
  resolveApplicableBudgets(input: {
    target: ApplicableBudgetTarget;
    projects: ProjectService;
    budgetDecisions: GatewayService;
    budgets: GatewayBudgetSpendPort | undefined;
  }): Promise<unknown>;
  /** The budget each named key carries of its own, with this period's spend. */
  loadDirectBudgetsForKeys(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    now: Date;
    chRepo: GatewayBudgetSpendPort | undefined;
  }): Promise<Map<string, unknown>>;
  /** Month-to-date spend per key from the cost path. */
  spendByVirtualKey(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    window: { fromDate: Date; toDate: Date };
    chRepo: GatewayBudgetSpendPort | undefined;
    spendRepo: GatewayVirtualKeySpendPort | undefined;
  }): Promise<Map<string, { spentUsd: string; requests: number }>>;
  /**
   * The canonical budget parser, taken rather than restated: its decimal regex
   * and positive-amount refinement are the write path's contract and must not
   * be able to drift from a second copy here.
   */
  schemas: Readonly<{ virtualKeyBudgetInput: z.ZodType<VirtualKeyBudgetInput> }>;
}>;

const routingModeSchema = z.enum(["NONE", "FALLBACK_ALL", "POLICY"]);

/**
 * The gateway's own scope-assignment wire shape. Annotated against
 * `GatewayVirtualKeyScope` so a tier added to the key's scope vocabulary is a
 * compile error here rather than a silently unaccepted value.
 */
const scopeAssignmentSchema: z.ZodType<GatewayVirtualKeyScope> = z.object({
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

const organizationScopeSchema = z.object({ organizationId: z.string() });
const idInput = z.object({ organizationId: z.string(), id: z.string() });

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
    TPorts extends VirtualKeyTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: VirtualKeyTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, resolverAuthorizedPolicy } = procedures;
    const budgetInputSchema = ports.schemas.virtualKeyBudgetInput;

    /** One key projected through the same batched read a listing uses. */
    const toDto = async (input: {
      virtualKey: VirtualKeyWithScopes;
      projects: VirtualKeyApplication["projects"];
    }) => {
      const [dto] = await ports.toVirtualKeyDtos({
        virtualKeys: [input.virtualKey],
        projects: input.projects,
      });
      return dto;
    };

    return trpc.router({
      // Visibility is membership-based, not permission-based: a caller sees a
      // key when one of its scopes intersects their membership set, so a plain
      // organization member can list without a coarse organization-wide
      // `virtualKeys:view` grant they would not hold.
      list: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; only keys whose scopes intersect the caller's membership in this organization are returned`,
        permissions: ["virtualKeys:view"],
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) => {
        const keys = await ports.listVisibleVirtualKeys({
          organizationId: input.organizationId,
          userId: ctx.actor().id,
          virtualKeys: ctx.app.gateway.virtualKeys,
        });
        return ports.toVirtualKeyDtos({ virtualKeys: keys, projects: ctx.app.projects });
      }),

      get: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; the key must exist in this organization and intersect the caller's membership set, and a miss is answered as not found`,
        permissions: ["virtualKeys:view"],
      })(procedure.input(idInput)).query(async ({ ctx, input }) => {
        // A key the caller can't see is indistinguishable from one that
        // doesn't exist — same NOT_FOUND, no existence leak.
        const vk = await ports.requireVisibleVirtualKey({
          organizationId: input.organizationId,
          id: input.id,
          userId: ctx.actor().id,
          virtualKeys: ctx.app.gateway.virtualKeys,
        });
        return toDto({ virtualKey: vk, projects: ctx.app.projects });
      }),

      /**
       * Spend per key for the current calendar month, for the keys the caller
       * can see. Reads the cost path, the same source the Usage tab reads, so
       * the number in the table matches the page a click on it lands on.
       *
       * Keys that carry a budget of their own also get that budget's limit and
       * its CURRENT-PERIOD spend, which is a different measurement from the
       * month total: a daily cap is measured against today. Both travel in this
       * one batched call so the table never asks per row.
       */
      spendThisMonth: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; spend is reported only for keys visible to the caller's membership in this organization`,
        permissions: ["virtualKeys:view"],
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) => {
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
        const keys = await ports.listVisibleVirtualKeys({
          organizationId: input.organizationId,
          userId: ctx.actor().id,
          virtualKeys: ctx.app.gateway.virtualKeys,
        });
        const now = new Date();
        const virtualKeyIds = keys.map((k) => k.id);
        const [spend, directBudgets] = await Promise.all([
          ports.spendByVirtualKey({
            organizationId: input.organizationId,
            virtualKeyIds,
            window: { fromDate: startOfCurrentMonthUTC(now), toDate: now },
            chRepo: undefined,
            spendRepo,
          }),
          ports.loadDirectBudgetsForKeys({
            organizationId: input.organizationId,
            virtualKeyIds,
            now,
            chRepo: ctx.app.gateway.budgets,
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
       * Every budget that would constrain this key: the "already applies" list
       * under the budget field in the create and edit drawers. Takes a draft —
       * the scopes the creator has picked, with no key row yet — so the list is
       * answerable before the key exists.
       */
      applicableBudgets: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; for an existing key, its visibility in this organization, and for a draft, manage on every scope in it, both checked before any budget data is read`,
        permissions: ["virtualKeys:view", "virtualKeys:manage"],
      })(
        procedure.input(
          z.object({
            organizationId: z.string(),
            virtualKeyId: z.string().nullable().optional(),
            scopes: z.array(scopeAssignmentSchema).min(1),
            traceProjectId: z.string().nullable().optional(),
            principalUserId: z.string().nullable().optional(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        // Authorization first, before any budget data is touched. This
        // resolver answers with budget names, limits, live spend and (for a
        // principal) their name, so knowing an organization id must not be
        // enough to call it.
        //
        // For an existing key (edit drawer): the caller must be able to SEE
        // the key, and resolution binds to the key's STORED ownership. The
        // caller-supplied scopes, destination and principal are ignored:
        // honouring them would let anyone who can see an organization-wide key
        // read a sibling team's budget names and spend by injecting that team's
        // scope into the input.
        if (input.virtualKeyId) {
          const vk = await ports.requireVisibleVirtualKey({
            organizationId: input.organizationId,
            id: input.virtualKeyId,
            userId: ctx.actor().id,
            virtualKeys: ctx.app.gateway.virtualKeys,
          });
          return ports.resolveApplicableBudgets({
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
            projects: ctx.app.projects,
            budgetDecisions: ctx.app.gateway.budgetDecisions,
            budgets: ctx.app.gateway.budgets,
          });
        }
        // For a draft (create drawer): the caller must hold
        // `virtualKeys:manage` on every draft scope AND on the chosen trace
        // destination — the exact boundary `create` will hold them to when they
        // submit. Previewing a target's budgets must not be cheaper than
        // creating a key against it.
        const principal = ctx.session;
        await ports.assertCanManageAllScopes({ principal, scopes: input.scopes });
        await ports.assertScopesBelongToOrganization({
          organizationId: input.organizationId,
          scopes: input.scopes,
        });
        await ports.assertTraceProjectBelongsToOrganization({
          organizationId: input.organizationId,
          traceProjectId: input.traceProjectId,
        });
        if (input.traceProjectId) {
          await ports.assertCanManageAllScopes({
            principal,
            scopes: [{ scopeType: "PROJECT", scopeId: input.traceProjectId }],
          });
        }
        // The principal id is still pinned to the organization: even an
        // authorized caller must not resolve another tenant's rows.
        if (input.principalUserId) {
          const member = await ports.isOrganizationMember({
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
        return ports.resolveApplicableBudgets({
          target: {
            organizationId: input.organizationId,
            virtualKeyId: null,
            scopes: input.scopes,
            traceProjectId: input.traceProjectId ?? null,
            principalUserId: input.principalUserId ?? null,
          },
          projects: ctx.app.projects,
          budgetDecisions: ctx.app.gateway.budgetDecisions,
          budgets: ctx.app.gateway.budgets,
        });
      }),

      create: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; manage on every requested scope, and every scope anchored to this organization, both before the key is minted`,
        permissions: ["virtualKeys:manage"],
      })(
        procedure.input(
          z.object({
            organizationId: z.string(),
            name: z.string().min(1).max(128),
            description: z.string().optional(),
            principalUserId: z.string().nullable().optional(),
            scopes: z.array(scopeAssignmentSchema).min(1),
            traceProjectId: z.string().nullable().optional(),
            routingPolicyId: z.string().nullable().optional(),
            routingMode: routingModeSchema.optional(),
            /** When the key stops serving. Omit it and the key never expires. */
            expiresAt: z.coerce.date().optional(),
            budget: budgetInputSchema.nullable().optional(),
            config: virtualKeyConfigSchema.partial().optional(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const actorUserId = ctx.actor().id;
        const principal = ctx.session;
        await ports.assertCanManageAllScopes({ principal, scopes: input.scopes });
        await ports.assertScopesBelongToOrganization({
          organizationId: input.organizationId,
          scopes: input.scopes,
        });
        await ports.assertTraceProjectBelongsToOrganization({
          organizationId: input.organizationId,
          traceProjectId: input.traceProjectId,
        });
        // The destination routes traces AND budget debits into that project, so
        // choosing it needs the same manage grant the old PROJECT scope
        // enforced; tenancy alone would let a team manager point a key at a
        // sibling team's project and consume its budget.
        if (input.traceProjectId) {
          await ports.assertCanManageAllScopes({
            principal,
            scopes: [{ scopeType: "PROJECT", scopeId: input.traceProjectId }],
          });
        }
        const vkProjectId = await ports.resolveVirtualKeyProjectId({
          organizationId: input.organizationId,
          virtualKeyId: null,
          scopes: input.scopes,
          traceProjectId: input.traceProjectId ?? null,
        });
        await ports.assertGuardrailAttachmentsAllowed({
          principal,
          projectId: vkProjectId,
          attachments: input.config?.guardrailAttachments,
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
        return { virtualKey: await toDto({ virtualKey, projects: ctx.app.projects }), secret };
      }),

      update: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes, plus manage on every new scope when re-scoping`,
        permissions: ["virtualKeys:update", "virtualKeys:manage"],
      })(
        procedure.input(
          z.object({
            organizationId: z.string(),
            id: z.string(),
            name: z.string().min(1).max(128).optional(),
            description: z.string().nullable().optional(),
            scopes: z.array(scopeAssignmentSchema).min(1).optional(),
            traceProjectId: z.string().nullable().optional(),
            routingPolicyId: z.string().nullable().optional(),
            routingMode: routingModeSchema.optional(),
            /** Omitted leaves it alone; null clears it; a date moves it. */
            expiresAt: z.coerce.date().nullable().optional(),
            budget: budgetInputSchema.nullable().optional(),
            config: virtualKeyConfigSchema.partial().optional(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const actorUserId = ctx.actor().id;
        const principal = ctx.session;
        const existing = await ports.requireExistingVirtualKey({
          organizationId: input.organizationId,
          id: input.id,
          virtualKeys: ctx.app.gateway.virtualKeys,
        });
        // Mutating an existing key needs `virtualKeys:update` on one of the
        // scopes it already lives in.
        await ports.assertCanOperateOnAnyScope({
          principal,
          scopes: existing.scopes,
          permission: "virtualKeys:update",
        });
        // Re-scoping additionally needs manage on every NEW scope, so a key
        // can't be moved into a scope the caller doesn't control.
        if (input.scopes) {
          await ports.assertCanManageAllScopes({ principal, scopes: input.scopes });
          await ports.assertScopesBelongToOrganization({
            organizationId: input.organizationId,
            scopes: input.scopes,
          });
        }
        if (input.traceProjectId !== undefined) {
          await ports.assertTraceProjectBelongsToOrganization({
            organizationId: input.organizationId,
            traceProjectId: input.traceProjectId,
          });
          // Re-pointing the destination is the same decision as choosing it at
          // create: it needs manage on the target project.
          if (input.traceProjectId) {
            await ports.assertCanManageAllScopes({
              principal,
              scopes: [{ scopeType: "PROJECT", scopeId: input.traceProjectId }],
            });
          }
        }
        const vkProjectId = await ports.resolveVirtualKeyProjectId({
          organizationId: input.organizationId,
          virtualKeyId: input.id,
          scopes: input.scopes,
          traceProjectId:
            input.traceProjectId !== undefined ? input.traceProjectId : existing.traceProjectId,
        });
        // Newly-submitted attachments are always validated. When the caller is
        // ALSO changing scopes (a possible project move) but did not re-send
        // config, revalidate the existing attachments against the new project
        // so a stale cross-project attachment can't survive the move. A plain
        // metadata update (no scope change, no new attachments) must not
        // re-touch existing attachments, otherwise renaming a key would demand
        // `gatewayGuardrails:attach`.
        const attachmentsToCheck =
          input.config?.guardrailAttachments ??
          (input.scopes !== undefined
            ? parseVirtualKeyConfig(existing.config).guardrailAttachments
            : undefined);
        await ports.assertGuardrailAttachmentsAllowed({
          principal,
          projectId: vkProjectId,
          attachments: attachmentsToCheck,
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
        return toDto({ virtualKey: updated, projects: ctx.app.projects });
      }),

      rotate: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; rotate on one of the key's existing scopes`,
        permissions: ["virtualKeys:rotate"],
      })(procedure.input(idInput)).mutation(async ({ ctx, input }) => {
        const actorUserId = ctx.actor().id;
        const principal = ctx.session;
        const existing = await ports.requireExistingVirtualKey({
          organizationId: input.organizationId,
          id: input.id,
          virtualKeys: ctx.app.gateway.virtualKeys,
        });
        await ports.assertCanOperateOnAnyScope({
          principal,
          scopes: existing.scopes,
          permission: "virtualKeys:rotate",
        });
        const { virtualKey, secret } = await ctx.app.gateway.virtualKeys.rotate({
          id: input.id,
          organizationId: input.organizationId,
          actorUserId,
        });
        // The second and last moment the plaintext key exists on the wire.
        return { virtualKey: await toDto({ virtualKey, projects: ctx.app.projects }), secret };
      }),

      revoke: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; delete on one of the key's existing scopes`,
        permissions: ["virtualKeys:delete"],
      })(procedure.input(idInput)).mutation(async ({ ctx, input }) => {
        const actorUserId = ctx.actor().id;
        const principal = ctx.session;
        const existing = await ports.requireExistingVirtualKey({
          organizationId: input.organizationId,
          id: input.id,
          virtualKeys: ctx.app.gateway.virtualKeys,
        });
        await ports.assertCanOperateOnAnyScope({
          principal,
          scopes: existing.scopes,
          permission: "virtualKeys:delete",
        });
        const updated = await ctx.app.gateway.virtualKeys.revoke({
          id: input.id,
          organizationId: input.organizationId,
          actorUserId,
        });
        return toDto({ virtualKey: updated, projects: ctx.app.projects });
      }),

      disable: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes`,
        permissions: ["virtualKeys:update"],
      })(procedure.input(idInput.extend({ reason: z.string().max(500).optional() }))).mutation(
        async ({ ctx, input }) => {
          const actorUserId = ctx.actor().id;
          const principal = ctx.session;
          const existing = await ports.requireExistingVirtualKey({
            organizationId: input.organizationId,
            id: input.id,
            virtualKeys: ctx.app.gateway.virtualKeys,
          });
          await ports.assertCanOperateOnAnyScope({
            principal,
            scopes: existing.scopes,
            permission: "virtualKeys:update",
          });
          const updated = await ctx.app.gateway.virtualKeys.disable({
            id: input.id,
            organizationId: input.organizationId,
            actorUserId,
            reason: input.reason ?? null,
          });
          return toDto({ virtualKey: updated, projects: ctx.app.projects });
        },
      ),

      enable: resolverAuthorizedPolicy({
        reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes`,
        permissions: ["virtualKeys:update"],
      })(procedure.input(idInput)).mutation(async ({ ctx, input }) => {
        const actorUserId = ctx.actor().id;
        const principal = ctx.session;
        const existing = await ports.requireExistingVirtualKey({
          organizationId: input.organizationId,
          id: input.id,
          virtualKeys: ctx.app.gateway.virtualKeys,
        });
        await ports.assertCanOperateOnAnyScope({
          principal,
          scopes: existing.scopes,
          permission: "virtualKeys:update",
        });
        const updated = await ctx.app.gateway.virtualKeys.enable({
          id: input.id,
          organizationId: input.organizationId,
          actorUserId,
        });
        return toDto({ virtualKey: updated, projects: ctx.app.projects });
      }),
    });
  }
}
