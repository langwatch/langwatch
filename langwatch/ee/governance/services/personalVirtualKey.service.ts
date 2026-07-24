// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * PersonalVirtualKeyService — owns personal-VK issuance + lifecycle.
 *
 * A personal VK is a regular `VirtualKey` row scoped at the personal
 * project via `VirtualKeyScope(scopeType=PROJECT)`. There is no
 * polymorphic ownerType column — the personal nature is derived from
 * the underlying Project.isPersonal flag.
 *
 * Service responsibilities:
 *   - `ensureDefault`: idempotently issue (or return existing) the
 *     user's "default personal VK" — the one the CLI gets back from
 *     /api/auth/cli/exchange. Auto-bound to the org's default
 *     RoutingPolicy when one exists.
 *   - `issue`: create an additional personal VK with a custom label.
 *   - `list`: list the caller's personal VKs in an org.
 *   - `revoke`: revoke one of the caller's personal VKs.
 *   - `revokeAllForUser`: cascade-revoke on user deactivation.
 *
 * Authorization is the caller's responsibility — this service never
 * checks permissions. tRPC routers + Hono handlers gate access first.
 */
import { type PrismaClient } from "@prisma/client";

import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import type { VirtualKeyWithScopes } from "~/server/gateway/virtualKey.repository";

import { resolveGatewayBaseUrl } from "./gatewayUrl";
import { PersonalWorkspaceService } from "./personalWorkspace.service";
import { RoutingPolicyService } from "./routingPolicy.service";

const DEFAULT_PERSONAL_VK_LABEL = "default";

export interface IssuedPersonalVk {
  /** Full VK row with scopes. */
  virtualKey: VirtualKeyWithScopes;
  /** Raw secret — exposed once, never persisted. */
  secret: string;
  /** Gateway base URL the CLI plugs into ANTHROPIC_BASE_URL etc. */
  baseUrl: string;
  /** Routing policy the VK was issued against (if any). */
  routingPolicyId: string | null;
  /**
   * Convenience aliases for the `personal_vk` payload returned via
   * /api/auth/cli/exchange + helper scripts (the wire shape uses
   * `id` + `label`, not `virtualKey.id` / `virtualKey.name`).
   */
  id: string;
  label: string;
}

export class PersonalVirtualKeyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly personalWorkspace: PersonalWorkspaceService,
    private readonly routingPolicy: RoutingPolicyService,
    private readonly gatewayBaseUrl: string,
  ) {}

  static create(
    prisma: PrismaClient,
    options?: { gatewayBaseUrl?: string; isSaas?: boolean },
  ): PersonalVirtualKeyService {
    return new PersonalVirtualKeyService(
      prisma,
      new PersonalWorkspaceService(prisma),
      new RoutingPolicyService(prisma),
      resolveGatewayBaseUrl({
        publicUrl: options?.gatewayBaseUrl,
        isSaas: options?.isSaas,
      }),
    );
  }

  /**
   * Idempotently return (or create) the user's default personal VK for
   * an organization. Called from the CLI device-flow approval handler
   * so every `langwatch login` returns a working key without forcing
   * the user to click anything else.
   *
   * Side-effects on first call:
   *   - Creates personal Team + Project if missing (via PersonalWorkspaceService).
   *   - Creates VK named "default" scoped to the personal project.
   *   - Auto-binds to the org's default RoutingPolicy if one exists at
   *     the team/org tier.
   */
  async ensureDefault({
    userId,
    organizationId,
    displayName,
    displayEmail,
  }: {
    userId: string;
    organizationId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }): Promise<IssuedPersonalVk> {
    const workspace = await this.personalWorkspace.ensure({
      userId,
      organizationId,
      displayName,
      displayEmail,
    });

    // Existing-key path: re-issue cannot return a fresh secret (the
    // original is hashed-only). Subsequent logins on the same device
    // just refresh tokens. Re-installing the CLI on a new device
    // requires a new key (issue() below).
    const existing = await this.prisma.virtualKey.findFirst({
      where: {
        organizationId,
        principalUserId: userId,
        name: DEFAULT_PERSONAL_VK_LABEL,
        revokedAt: null,
        scopes: {
          some: { scopeType: "PROJECT", scopeId: workspace.project.id },
        },
      },
      include: { scopes: true },
    });

    if (existing) {
      throw new PersonalVirtualKeyAlreadyExistsError(existing.id);
    }

    return await this.issue({
      userId,
      organizationId,
      personalProjectId: workspace.project.id,
      personalTeamId: workspace.team.id,
      label: DEFAULT_PERSONAL_VK_LABEL,
    });
  }

  /**
   * Issue a new personal VK with the given label. Used both by
   * `ensureDefault` (label="default") and by the explicit
   * `virtualKey.issuePersonal` tRPC mutation (custom label).
   */
  async issue({
    userId,
    organizationId,
    personalProjectId,
    personalTeamId,
    label,
    routingPolicyId,
  }: {
    userId: string;
    organizationId: string;
    personalProjectId: string;
    personalTeamId?: string;
    label: string;
    routingPolicyId?: string | null;
  }): Promise<IssuedPersonalVk> {
    const policy =
      routingPolicyId !== undefined
        ? routingPolicyId
          ? await this.routingPolicy.findById(routingPolicyId)
          : null
        : await this.routingPolicy.resolveDefaultForUser({
            organizationId,
            personalTeamId,
          });

    // Cross-org-policy guard. The tRPC caller (issuePersonal) accepts
    // a user-controlled routingPolicyId — without an org-scope check
    // here, a user could attach a policy from another organization
    // they discovered the id of.
    if (
      routingPolicyId &&
      policy &&
      policy.organizationId !== organizationId
    ) {
      throw new PersonalVirtualKeyNotFoundError(routingPolicyId);
    }

    // Default-resolution path: when the caller did not pin a specific
    // routingPolicyId AND the org has no default policy (or the
    // default points at an empty provider list), fall back to minting
    // the VK with `routingPolicyId: null`. The gateway's
    // `eligibleModelProvidersForVk` already handles a null policy by
    // ranking every scope-cascade-eligible ModelProvider on
    // `fallbackPriorityGlobal` ASC then `createdAt` ASC — so the VK
    // dispatches correctly as long as at least one provider is
    // reachable. Only when truly zero providers are reachable does the
    // mint fail with an actionable error.
    //
    // When the caller pinned an explicit routingPolicyId, the empty-
    // policy invariant from G34 still applies — they asked for THIS
    // policy and we refuse to silently substitute a different shape.
    // Both "no policy id provided" (undefined → default-resolution) and
    // "no policy requested" (explicit null) collapse into the same
    // mint-with-null-policy branch — they both end up with a VK whose
    // routingPolicyId is null and rely on the gateway's cascade
    // ordering. Either way we still owe the caller the no-provider
    // guard, otherwise an empty org could mint a broken VK by passing
    // `routingPolicyId: null` explicitly.
    const noPolicyRequested =
      routingPolicyId === undefined || routingPolicyId === null;
    const policyIsEmpty =
      !!policy && extractModelProviderIds(policy).length === 0;

    if (noPolicyRequested && (!policy || policyIsEmpty)) {
      const eligibleCount = await this.countEligibleProviders({
        organizationId,
        personalTeamId,
        personalProjectId,
      });
      if (eligibleCount === 0) {
        throw new NoEligibleProvidersError(organizationId);
      }
      // Fall through with policy = null (gateway uses cascade order).
    } else if (policyIsEmpty) {
      // Caller pinned an empty policy explicitly — preserve the
      // validate-before-mint contract from G34.
      throw new RoutingPolicyHasNoProvidersError(policy!.id, policy!.name);
    }

    const resolvedPolicyId =
      noPolicyRequested && (!policy || policyIsEmpty) ? null : policy?.id ?? null;

    const vkService = VirtualKeyService.create(this.prisma);
    const { virtualKey, secret } = await vkService.create({
      organizationId,
      name: label,
      description: "Personal virtual key",
      principalUserId: userId,
      actorUserId: userId,
      scopes: [{ scopeType: "PROJECT", scopeId: personalProjectId }],
      routingPolicyId: resolvedPolicyId,
    });

    return {
      virtualKey,
      secret,
      baseUrl: this.gatewayBaseUrl,
      routingPolicyId: resolvedPolicyId,
      id: virtualKey.id,
      label: virtualKey.name,
    };
  }

  /**
   * List personal VKs in an org. Never includes the secret.
   *
   * `userId` scopes the result to one principal (the caller's own keys, or
   * a specific user's keys for an off-boarding sweep). Omit it to list every
   * personal VK in the org — used by admins holding
   * `virtualKeys:viewOtherPersonal`. The caller is responsible for the perm
   * check; this service never authorizes.
   */
  async list({
    userId,
    organizationId,
  }: {
    userId?: string;
    organizationId: string;
  }) {
    return await this.prisma.virtualKey.findMany({
      where: {
        organizationId,
        principalUserId: userId !== undefined ? userId : { not: null },
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        description: true,
        displayPrefix: true,
        status: true,
        principalUserId: true,
        routingPolicyId: true,
        createdAt: true,
        updatedAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Revoke a single personal VK. Verifies the VK belongs to `userId`
   * before delegating to the gateway VK service (which also writes the
   * audit + change-event entries).
   */
  async revoke({
    userId,
    organizationId,
    virtualKeyId,
  }: {
    userId: string;
    organizationId: string;
    virtualKeyId: string;
  }) {
    const vk = await this.prisma.virtualKey.findFirst({
      where: {
        id: virtualKeyId,
        organizationId,
        principalUserId: userId,
      },
      select: { id: true, organizationId: true },
    });
    if (!vk) {
      throw new PersonalVirtualKeyNotFoundError(virtualKeyId);
    }

    const vkService = VirtualKeyService.create(this.prisma);
    return await vkService.revoke({
      id: vk.id,
      organizationId: vk.organizationId,
      actorUserId: userId,
    });
  }

  /**
   * Count ModelProviders that a personal VK at the given personal team /
   * project would see via scope cascade (PROJECT → TEAM → ORGANIZATION).
   * Used as the gate for the no-default-policy graceful-fallback path:
   * if any provider is reachable, mint with routingPolicyId=null instead
   * of refusing the request. Mirrors the scope predicates in
   * `eligibleModelProvidersForVk`.
   */
  private async countEligibleProviders({
    organizationId,
    personalTeamId,
    personalProjectId,
  }: {
    organizationId: string;
    personalTeamId?: string;
    personalProjectId: string;
  }): Promise<number> {
    const scopePredicates: Array<{
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }> = [{ scopeType: "ORGANIZATION", scopeId: organizationId }];
    if (personalTeamId) {
      scopePredicates.push({ scopeType: "TEAM", scopeId: personalTeamId });
    }
    scopePredicates.push({ scopeType: "PROJECT", scopeId: personalProjectId });

    return await this.prisma.modelProvider.count({
      where: {
        enabled: true,
        disabledAt: null,
        scopes: { some: { OR: scopePredicates } },
      },
    });
  }

  /**
   * Cascade revoke every personal VK belonging to a user.
   * Called from the user-deactivation path (out of scope for this
   * iteration — wiring point exists for follow-up).
   */
  async revokeAllForUser({
    userId,
    actorUserId,
  }: {
    userId: string;
    actorUserId: string;
  }): Promise<number> {
    const personalVks = await this.prisma.virtualKey.findMany({
      where: {
        principalUserId: userId,
        revokedAt: null,
      },
      select: { id: true, organizationId: true },
    });

    const vkService = VirtualKeyService.create(this.prisma);
    for (const vk of personalVks) {
      await vkService.revoke({
        id: vk.id,
        organizationId: vk.organizationId,
        actorUserId,
      });
    }
    return personalVks.length;
  }
}

export class PersonalVirtualKeyAlreadyExistsError extends Error {
  constructor(public readonly virtualKeyId: string) {
    super(
      `User already has a default personal VK (${virtualKeyId}); use issue() with a custom label for additional keys`,
    );
    this.name = "PersonalVirtualKeyAlreadyExistsError";
  }
}

export class PersonalVirtualKeyNotFoundError extends Error {
  constructor(public readonly virtualKeyId: string) {
    super(`Personal virtual key ${virtualKeyId} not found or not owned by caller`);
    this.name = "PersonalVirtualKeyNotFoundError";
  }
}

/**
 * Thrown by `issue()` when the caller relied on default-policy
 * resolution (no `routingPolicyId` argument) and the organization has
 * NO ModelProvider reachable from the user's personal team via scope
 * cascade. Without any eligible provider the gateway would have
 * nothing to route to, so the mint is refused with a clear
 * "configure a provider" message. Routes / tRPC handlers translate
 * this to HTTP 409 with `{ error: "no_eligible_providers" }`.
 *
 * Distinct from `RoutingPolicyHasNoProvidersError`: that one fires
 * when the caller pinned an empty policy explicitly (G34 invariant).
 * This one fires when no policy was requested AND the cascade is
 * empty — i.e. the org genuinely has no providers configured yet.
 */
export class NoEligibleProvidersError extends Error {
  constructor(public readonly organizationId: string) {
    super(
      `Your organization has no AI providers configured. Ask an admin to add one at Settings → Model Providers.`,
    );
    this.name = "NoEligibleProvidersError";
  }
}

/**
 * Thrown by `issue()` when the resolved routing policy exists but has
 * zero ModelProviders configured. Without providers, any subsequent
 * gateway call against the minted VK would 504 with `provider_timeout`.
 */
export class RoutingPolicyHasNoProvidersError extends Error {
  constructor(
    public readonly routingPolicyId: string,
    public readonly routingPolicyName: string,
  ) {
    super(
      `Routing policy "${routingPolicyName}" has no providers configured. Ask your organization admin to add at least one provider in Settings → Routing Policies before issuing keys.`,
    );
    this.name = "RoutingPolicyHasNoProvidersError";
  }
}

/**
 * Read the `modelProviderIds: Json` column off a RoutingPolicy row as a
 * `string[]`. The column is typed as `Json` in Prisma but is always an
 * array of ModelProvider ids in practice (default `"[]"`, service-layer
 * always writes an array). Returns `[]` for any non-array shape.
 */
function extractModelProviderIds(policy: {
  modelProviderIds: unknown;
}): string[] {
  const raw = policy.modelProviderIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}
