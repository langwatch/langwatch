/**
 * The invariants every virtual-key write must satisfy: what a key may be named, where its traces
 * land, which providers its scope graph actually reaches, and how a routing mode and its policy
 * reference agree. Shared by provisioning and the status changes so the two cannot drift apart.
 */

import { type Instant, nowInstant } from "@langwatch/time";
import type {
  ScopeInput,
  VirtualKeyBudgetInput,
  VirtualKeyWithScopes,
} from "@langwatch/gateway-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  serializeRowForAudit,
  type GatewayAuditJson,
  type GuardrailAttachment,
  type GuardrailDirection,
  type ResourceMetadata,
  type VirtualKey,
  type VirtualKeyConfig,
  type VirtualKeyRoutingMode,
} from "@langwatch/gateway-contract";
import {
  GatewayTraceProjectAmbiguousError,
  GatewayTraceProjectRequiredError,
  GatewayTraceProjectUnknownError,
  VirtualKeyExpiryInPastError,
} from "@langwatch/gateway-contract";
import type { GatewayScopeResolutionService } from "./gateway-scope-resolution.service.ts";
import type { GatewayPersistenceTransaction } from "../ports/gateway-change-events.port.ts";
import type { GatewayVirtualKeysPort } from "../ports/gateway-virtual-key.port.ts";

export const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

// Joins a guardrail direction to its id in a set key. A NUL can never appear in either half.
const GUARDRAIL_KEY_SEPARATOR = "\0";


export type CreateVirtualKeyInput = {
  organizationId: string;
  name: string;
  description?: string | null;
  principalUserId?: string | null;
  actorUserId: string;
  /** Optional cap created alongside the key, targeted at the key. */
  budget?: VirtualKeyBudgetInput | null;
  /** Defaults to NONE: a new key does not silently fail over. */
  routingMode?: VirtualKeyRoutingMode;
  /**
   * Visibility set: every (scopeType, scopeId) the VK is reachable from.
   * At least one entry is required. Caller is responsible for asserting
   * `virtualKeys:manage` at each scope before calling.
   */
  scopes: ScopeInput[];
  /** The caller's own id for this key; must be free within the organization. */
  externalId?: string | null;
  /** Customer-owned bookkeeping. Never read by the gateway. */
  metadata?: ResourceMetadata;
  /**
   * Where this key's traces and costs should land. NOT a scope: it grants no
   * visibility or operate rights. Omit it and the destination is decided from
   * what the key is scoped to; either way the answer is stored on the key.
   */
  traceProjectId?: string | null;
  /**
   * Optional RoutingPolicy reference. When set, the policy is the
   * authoritative ordering for the VK's eligible-MP chain at request
   * time. Policy must belong to `organizationId`.
   */
  routingPolicyId?: string | null;
  /**
   * When the key stops serving. Absent or null means it never expires. A
   * moment that has already passed is refused rather than stored: the key
   * would be dead on arrival.
   */
  expiresAt?: Instant | null;
  config?: Partial<VirtualKeyConfig>;
  /**
   * USER (default) for keys created via the gateway UI/API; LANGY when
   * auto-provisioned by Langy. Anything other than USER marks the key
   * product-managed (see `isProductManaged`).
   */
  purpose?: "USER" | "LANGY";
};

export type UpdateVirtualKeyInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
  name?: string;
  description?: string | null;
  scopes?: ScopeInput[];
  /** Undefined leaves it alone; null clears it; a value claims it. */
  externalId?: string | null;
  /** Undefined leaves the stored map alone; a value REPLACES it wholesale. */
  metadata?: ResourceMetadata;
  /**
   * Undefined leaves the stored destination where it is, scope edits
   * included; a value moves it, validated as on create; null asks for it to
   * be worked out again from what the key is now.
   */
  traceProjectId?: string | null;
  routingPolicyId?: string | null;
  routingMode?: VirtualKeyRoutingMode;
  /**
   * Undefined leaves the expiration where it is; null clears it; a moment
   * moves it. Extending an expired key is why expiry is a moment, not a status.
   */
  expiresAt?: Instant | null;
  config?: Partial<VirtualKeyConfig>;
  /**
   * Undefined leaves the key's budget alone; a value creates or updates
   * it; null archives it.
   */
  budget?: VirtualKeyBudgetInput | null;
};

export type RotateVirtualKeyInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
};

export type RevokeVirtualKeyInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
};

export type CreatedVirtualKey = {
  virtualKey: VirtualKeyWithScopes;
  /** Raw secret — exposed to the caller once and never persisted. */
  secret: string;
};

type GuardrailPair = { direction: GuardrailDirection; guardrailId: string };

export class VirtualKeyValidationService {
  /**
   * Keys the product provisions and owns rather than the customer — today only
   * the Langy VK. Absent from customer-facing reads; refuses customer-facing
   * mutations (`rotate` would break Langy's own auth against the secret).
   */
  static isProductManaged(vk: Pick<VirtualKey, "purpose">): boolean {
    return vk.purpose !== "USER";
  }

  /**
   * Reconcile the requested routing mode with the policy reference: one
   * decision expressed in two columns, enforced here rather than trusted
   * from every caller.
   */
  static resolveRoutingMode(
    requested: VirtualKeyRoutingMode | undefined,
    routingPolicyId: string | null,
  ): VirtualKeyRoutingMode {
    const mode = requested ?? (routingPolicyId ? "POLICY" : "NONE");
    if (mode === "POLICY" && !routingPolicyId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "routing_policy_required: routingMode POLICY needs a routingPolicyId",
      });
    }

    if (mode !== "POLICY" && routingPolicyId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `routing_policy_conflict: routingMode ${mode} cannot carry a routingPolicyId`,
      });
    }

    return mode;
  }

  /**
   * "No providers selected" is never a valid saved state. Absence means
   * every provider in scope; an empty list would mean a key that can serve
   * nothing, which is always a mis-click rather than an intent.
   */
  static assertProvidersAllowedShape(providersAllowed: string[] | null | undefined): void {
    if (providersAllowed === undefined || providersAllowed === null) {
      return;
    }

    if (providersAllowed.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "providers_allowed_empty: select at least one provider, or allow all providers",
      });
    }
  }

  /**
   * A key is never written already expired. Absence leaves the stored moment
   * alone and null clears it, so only a real one is checked, against the
   * moment of the write — "now" itself is a refusal.
   */
  static assertExpiryInFuture({ expiresAt }: { expiresAt: Instant | null | undefined }): void {
    if (!expiresAt) {
      return;
    }

    if (expiresAt.epochMilliseconds <= nowInstant().epochMilliseconds) {
      throw new VirtualKeyExpiryInPastError();
    }
  }

  /**
   * Flatten `[{direction, guardrailIds[]}]` tuples into per-(direction, id)
   * pairs and diff old vs new so the update path can emit one
   * attach/detach audit row per wire change.
   */
  static diffGuardrailAttachments(
    before: GuardrailAttachment[],
    after: GuardrailAttachment[],
  ): { attached: GuardrailPair[]; detached: GuardrailPair[] } {
    const flatten = (attachments: GuardrailAttachment[]): Set<string> => {
      const set = new Set<string>();
      for (const a of attachments) {
        for (const id of a.guardrailIds) {
          set.add(`${a.direction}${GUARDRAIL_KEY_SEPARATOR}${id}`);
        }
      }

      return set;
    };
    const toPair = (key: string): GuardrailPair => {
      const [direction, guardrailId] = key.split(GUARDRAIL_KEY_SEPARATOR);

      return {
        direction: direction as GuardrailDirection,
        guardrailId: guardrailId!,
      };
    };
    const beforeSet = flatten(before);
    const afterSet = flatten(after);
    const attached: GuardrailPair[] = [];
    const detached: GuardrailPair[] = [];
    for (const key of afterSet) {
      if (!beforeSet.has(key)) {
        attached.push(toPair(key));
      }
    }

    for (const key of beforeSet) {
      if (!afterSet.has(key)) {
        detached.push(toPair(key));
      }
    }

    return { attached, detached };
  }

  static serialiseForAudit(vk: VirtualKeyWithScopes): GatewayAuditJson {
    // Strip secret material. The base serializer already handles BigInt
    // (revision) safely — see auditSerializer.ts.
    const {
      hashedSecret: _hashedSecret,
      previousHashedSecret: _previousHashedSecret,
      ...safe
    } = vk;

    return serializeRowForAudit(safe as unknown as Record<string, unknown>);
  }

  private constructor(
    private readonly repository: GatewayVirtualKeysPort,
    private readonly scopeResolution: GatewayScopeResolutionService,
    private readonly projects: ProjectApi,
  ) {}

  static create(input: {
    repository: GatewayVirtualKeysPort;
    scopeResolution: GatewayScopeResolutionService;
    projects: ProjectApi;
  }): VirtualKeyValidationService {
    return new VirtualKeyValidationService(input.repository, input.scopeResolution, input.projects);
  }

  /**
   * Loads a key for mutation. Product-managed keys are rejected here rather
   * than in each caller, so `update` / `rotate` / `revoke` cannot drift apart
   * — NOT_FOUND for the same reason `tryGetById` returns null.
   */
  async ownedForMutation(id: string, organizationId: string): Promise<VirtualKeyWithScopes> {
    const existing = await this.repository.tryFindById({ id, organizationId });
    if (!existing || VirtualKeyValidationService.isProductManaged(existing)) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Virtual key not found",
      });
    }

    return existing;
  }

  /**
   * Every key must SAY where its traces land (cases:
   * `ProjectApi.resolveTraceDestination`). Revocation is not guarded.
   * Spec: specs/ai-gateway/virtual-key-creation.feature
   */
  async resolveStoredTraceDestination(
    input: Pick<CreateVirtualKeyInput, "organizationId" | "scopes" | "traceProjectId">,
  ): Promise<string> {
    const decision = await this.projects.resolveTraceDestination({
      organizationId: input.organizationId,
      projectScopeIds: input.scopes
        .filter((scope) => scope.scopeType === "PROJECT")
        .map((scope) => scope.scopeId),
      traceProjectId: input.traceProjectId,
    });
    switch (decision.outcome) {
      case "resolved":
        return decision.project.id;
      case "unknown":
        throw new GatewayTraceProjectUnknownError();
      case "ambiguous":
        throw new GatewayTraceProjectAmbiguousError({
          projectScopeCount: decision.projectScopeCount,
        });
      case "no_destination":
        throw new GatewayTraceProjectRequiredError();
    }
  }

  /**
   * What an update leaves in the destination column. Untouched stays exactly
   * where it is, even when scopes move. Named validates like create; explicit
   * null re-runs the whole decision.
   */
  async nextStoredTraceDestination(args: {
    existing: VirtualKeyWithScopes;
    input: UpdateVirtualKeyInput;
  }): Promise<string> {
    const { existing, input } = args;
    if (input.traceProjectId === undefined && existing.traceProjectId) {
      return existing.traceProjectId;
    }

    return this.resolveStoredTraceDestination({
      organizationId: input.organizationId,
      scopes: input.scopes ?? existing.scopes,
      traceProjectId: input.traceProjectId ?? null,
    });
  }

  /**
   * An explicit provider allowlist may only name providers the key can reach
   * through its SCOPE graph, not the routing-policy-narrowed dispatch set (the
   * policy blocks at dispatch, not at save).
   */
  async assertProvidersAllowedReachable(
    vk: VirtualKeyWithScopes,
    providersAllowed: string[] | null,
    tx: GatewayPersistenceTransaction,
  ): Promise<void> {
    if (!providersAllowed) {
      return;
    }

    const reachable = await this.scopeResolution.scopeReachableModelProvidersForVk(vk, tx);
    const reachableIds = new Set(reachable.map((mp) => mp.id));
    const unreachable = providersAllowed.filter((id) => !reachableIds.has(id));
    if (unreachable.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `providers_not_in_scope: ${unreachable.join(", ")}`,
      });
    }
  }

  async assertRoutingPolicyBelongsToOrg(
    routingPolicyId: string,
    organizationId: string,
  ): Promise<void> {
    const policy = await this.repository.tryFindRoutingPolicyOwner({ routingPolicyId });
    if (!policy) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Routing policy ${routingPolicyId} not found`,
      });
    }

    if (policy.organizationId !== organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Routing policy belongs to a different organization than the virtual key",
      });
    }
  }
}
