/**
 * The seam between the gateway's public REST surface and the process it runs
 * in.
 *
 * The same seam the gateway's tRPC transports already have
 * (`GatewayTrpcPorts`), and for the same reason: who may see a key, who may
 * operate on one of its scopes, and where a receipt is stored are all decided
 * against role bindings, memberships and tables this package has no access to.
 * Every entry here fronts one of those decisions, so REST and tRPC reach the
 * SAME implementation and the two doors into the gateway cannot drift apart —
 * which is the property the public-rest-api spec exists to hold.
 *
 * Everything that is NOT such a decision — wire casing, cursors, money
 * formatting, the DTO shapes — lives in `@langwatch/gateway-server` and is
 * imported directly rather than passed through here.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { GatewayService, GuardrailAttachment } from "@langwatch/gateway-contract";
import type {
  GatewayVirtualKeyScope,
  VirtualKeySnakeDto,
  VirtualKeyWithScopes,
} from "@langwatch/gateway-server";
import type { ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import type { Project } from "@langwatch/prisma-client/generated";
import type { z } from "zod";

import type { IdempotentRunner } from "../../app-rest";

/**
 * The identity a write authorizes as, in whatever vocabulary the process's own
 * gateway authorization uses.
 *
 * Opaque on purpose. A REST caller here is a scoped API key or a legacy
 * project key, and what either of those IS belongs to the process's
 * authentication, not to this transport. The transport asks
 * {@link GatewayPlatformRestPorts.actorForCredential} for one and hands it
 * straight back to the ports that check it.
 */
export type GatewayRestActor = unknown;

/** The virtual-key WRITE capability this surface calls. */
export type GatewayRestVirtualKeyWrites = Readonly<{
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
    budget?: GatewayRestVirtualKeyBudgetInput | null;
    config?: unknown;
    externalId?: string | null;
    metadata?: Record<string, string>;
    actorUserId: string;
  }): Promise<{ virtualKey: VirtualKeyWithScopes; secret: string }>;
  update(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    name?: string;
    description?: string | null;
    scopes?: GatewayVirtualKeyScope[];
    traceProjectId?: string | null;
    routingPolicyId?: string | null;
    routingMode?: "FALLBACK_ALL" | "NONE" | "POLICY";
    expiresAt?: Date | null;
    budget?: GatewayRestVirtualKeyBudgetInput | null;
    config?: unknown;
    externalId?: string | null;
    metadata?: Record<string, string>;
  }): Promise<VirtualKeyWithScopes>;
  rotate(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<{ virtualKey: VirtualKeyWithScopes; secret: string }>;
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
  revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<VirtualKeyWithScopes>;
}>;

/**
 * The budget a key may carry of its own, as the write service takes it.
 *
 * The canonical parser arrives as `schemas.virtualKeyBudgetInput`, so the
 * decimal regex and the positive-amount refinement are never restated here.
 */
export type GatewayRestVirtualKeyBudgetInput = Readonly<{
  limitUsd: string;
  window: "DAY" | "WEEK" | "MONTH";
  onBreach?: "BLOCK" | "WARN";
  name?: string;
}>;

/** The read half. Which keys a caller may SEE is not the service's decision. */
export type GatewayRestVirtualKeyReads = Readonly<{
  getPage(input: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Date; id: string } | null;
    externalId?: string;
  }): Promise<VirtualKeyWithScopes[]>;
}>;

/**
 * Everything the public gateway REST surface needs from its process.
 *
 * Resolved per request through a provider, so mounting the family never
 * constructs a service and the spec generator can build every route with none.
 */
export type GatewayPlatformRestPorts = Readonly<{
  /** The key write/read capability, shared with the tRPC transports. */
  virtualKeys: GatewayRestVirtualKeyWrites & GatewayRestVirtualKeyReads;
  /** The budget-and-cache-rule capability, shared with the tRPC transports. */
  budgets: GatewayService;
  /**
   * Whether this deployment has the ClickHouse spend source key spend is read
   * from. False answers 412 `spend_source_unavailable` rather than a $0.00
   * that cannot be told apart from a key that genuinely spent nothing.
   */
  spendSourceAvailable: boolean;

  /**
   * The organization behind the project the API key authenticated as. Every
   * gateway resource is organization-owned, so it is the tenancy key for the
   * whole surface.
   */
  organizationIdForProject(projectId: string): Promise<string>;

  /**
   * The identity this credential authorizes as, plus the id audit rows record.
   *
   * A scoped API key acts as its owning user. A legacy project key carries no
   * user, so it acts as a stable synthetic machine principal for its project,
   * which keeps an audit entry traceable back to the credential that made it.
   */
  actorForCredential(input: {
    projectId: string;
    resolvedToken: ResolvedApiKeyToken | undefined;
  }): { actor: GatewayRestActor; actorUserId: string };

  /**
   * The keys on a page this project credential may see: the credential stands
   * in for someone working in its project, so it sees organization-scoped
   * keys, its own team's keys and its own project's keys — and not a sibling
   * team's. Applied to the page rather than to the query, which is why a page
   * can be shorter than `limit` without meaning the walk is done.
   */
  visibleToProjectCredential(input: {
    project: Project;
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): VirtualKeyWithScopes[];
  /** One key under that same visibility rule, or the not-found refusal. */
  requireVisibleVirtualKey(input: {
    project: Project;
    id: string;
    organizationId: string;
  }): Promise<VirtualKeyWithScopes>;
  /** One key anchored to this organization, without the visibility rule. */
  requireExistingVirtualKey(input: {
    id: string;
    organizationId: string;
  }): Promise<VirtualKeyWithScopes>;

  /** `virtualKeys:manage` on EVERY named scope, fail-closed. */
  assertCanManageAllScopes(input: {
    actor: GatewayRestActor;
    scopes: readonly GatewayVirtualKeyScope[];
  }): Promise<void>;
  /** One named permission on AT LEAST ONE of the key's existing scopes. */
  assertCanOperateOnAnyScope(input: {
    actor: GatewayRestActor;
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
    actor: GatewayRestActor;
    projectId: string | null;
    attachments: readonly GuardrailAttachment[] | undefined;
  }): Promise<void>;
  /** The project a key's guardrail attachments are judged against. */
  resolveVirtualKeyProjectId(input: {
    organizationId: string;
    virtualKeyId: string | null;
    scopes: readonly GatewayVirtualKeyScope[] | undefined;
    traceProjectId: string | null;
  }): Promise<string | null>;

  /**
   * The published snake_case projection for a page of keys, in ONE read of the
   * trace destinations however long the page: a listing must not cost a query
   * per key to say where each one's traffic goes.
   */
  toVirtualKeyDtos(input: {
    virtualKeys: readonly VirtualKeyWithScopes[];
  }): Promise<VirtualKeySnakeDto[]>;

  /**
   * How many members a per-member GROUP allowance currently covers, batched
   * over however many GROUP rows a response carries.
   */
  groupMemberCounts(
    budgets: readonly { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, number>>;

  /**
   * Spend and request count per key over a window, from the cost path — the
   * same source the dashboard's key list and Usage tab read, so this number,
   * the UI column and the Usage page agree by construction. Only called when
   * {@link spendSourceAvailable} is true.
   */
  spendByVirtualKey(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
    window: { fromDate: Date; toDate: Date };
  }): Promise<Map<string, { spentUsd: string; requests: number }>>;

  /**
   * The receipt ledger the creates dispatch through, already bound to the
   * process's store. A family cannot hold one of its own: a receipt is an
   * encrypted row in the application's database.
   */
  idempotency: IdempotentRunner;

  /**
   * The canonical budget parser, taken rather than restated: its decimal regex
   * and positive-amount refinement are the write path's contract and must not
   * be able to drift from a second copy here.
   */
  schemas: Readonly<{
    virtualKeyBudgetInput: z.ZodType<GatewayRestVirtualKeyBudgetInput>;
  }>;
}>;
