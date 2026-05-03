/**
 * PersonalVirtualKeyService — owns personal-VK issuance + lifecycle.
 *
 * A personal VK is just a regular `VirtualKey` row whose `projectId`
 * points to a personal project (Project.isPersonal=true). No
 * polymorphic ownerType column — the personal nature is fully derived
 * from the project flag, which keeps the gateway dispatcher unchanged.
 *
 * Service responsibilities:
 *   - `ensureDefault`: idempotently issue (or return existing) the
 *     user's "default personal VK" — the one the CLI gets back from
 *     /api/auth/cli/exchange. Auto-bound to the org's default
 *     RoutingPolicy when one exists.
 *   - `issue`: create an additional personal VK with a custom label
 *     (e.g. "jane-laptop", "jane-cron-runner").
 *   - `list`: list the caller's personal VKs in an org.
 *   - `revoke`: revoke one of the caller's personal VKs.
 *   - `revokeAllForUser`: cascade-revoke on user deactivation.
 *
 * Authorization is the caller's responsibility — this service never
 * checks permissions. tRPC routers + Hono handlers gate access first.
 */
import { type PrismaClient } from "@prisma/client";

import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import type { VirtualKeyWithChain } from "~/server/gateway/virtualKey.repository";

import { PersonalWorkspaceService } from "./personalWorkspace.service";
import { RoutingPolicyService } from "./routingPolicy.service";

const DEFAULT_PERSONAL_VK_LABEL = "default";

export interface IssuedPersonalVk {
  /** Full VK row with chain. */
  virtualKey: VirtualKeyWithChain;
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
    options?: { gatewayBaseUrl?: string },
  ): PersonalVirtualKeyService {
    return new PersonalVirtualKeyService(
      prisma,
      new PersonalWorkspaceService(prisma),
      new RoutingPolicyService(prisma),
      options?.gatewayBaseUrl ?? "https://gateway.langwatch.com",
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
   *   - Creates VK named "default" inside that personal project.
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

    // Look for an existing default-labelled personal VK on the
    // personal project. Re-issue path returns the row without a new
    // secret (we don't expose secrets after creation).
    const existing = await this.prisma.virtualKey.findFirst({
      where: {
        projectId: workspace.project.id,
        name: DEFAULT_PERSONAL_VK_LABEL,
        revokedAt: null,
      },
      include: { providerCredentials: true },
    });

    if (existing) {
      // For idempotency we cannot return a fresh secret (the original
      // is hashed-only). The CLI is expected to call this on first
      // login and persist the secret; subsequent logins on the same
      // device just refresh tokens. If a user re-installs the CLI on
      // a new device they need to issue a NEW key (issue() below).
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
    // they discovered the id of. Today the only path to this branch
    // is the issuePersonal mutation; the device-exchange flow goes
    // through resolveDefaultForUser which is already org-scoped.
    if (
      routingPolicyId &&
      policy &&
      policy.organizationId !== organizationId
    ) {
      throw new PersonalVirtualKeyNotFoundError(routingPolicyId);
    }

    // Spec contract (specs/ai-gateway/governance/personal-keys.feature
    // lines 57-63): when the caller relied on default-policy resolution
    // (routingPolicyId omitted) and the org has no default policy, the
    // device-exchange MUST 409 with `{ error: "no_default_routing_policy" }`
    // and NO personal VK should be created. The earlier "create bare VK,
    // gateway rejects later" approach contradicted that contract — calls
    // would silently issue a VK secret that 4xxd at request time.
    // Throw a typed error so the route translates it to the spec'd 409
    // (see /api/auth/cli/exchange).
    if (routingPolicyId === undefined && !policy) {
      throw new NoDefaultRoutingPolicyError(organizationId);
    }

    // Personal VKs delegate provider-chain resolution to the routing
    // policy at request time — no embedded VirtualKeyProviderCredential
    // rows. VirtualKeyService.create accepts an empty
    // providerCredentialIds list iff `routingPolicyId` is set, and
    // skips the per-project ownership assertion in that case (policies
    // are org-scoped and may reference credentials living in other
    // projects of the same org).
    const vkService = VirtualKeyService.create(this.prisma);
    const { virtualKey, secret } = await vkService.create({
      projectId: personalProjectId,
      organizationId,
      name: label,
      description: `Personal key for ${label}`,
      environment: "live",
      principalUserId: userId,
      actorUserId: userId,
      providerCredentialIds: [],
      routingPolicyId: policy?.id ?? null,
    });

    return {
      virtualKey,
      secret,
      baseUrl: this.gatewayBaseUrl,
      routingPolicyId: policy?.id ?? null,
      id: virtualKey.id,
      label: virtualKey.name,
    };
  }

  /**
   * List the caller's personal VKs across personal projects in an org.
   * Never includes the secret.
   */
  async list({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }) {
    // dbMultiTenancyProtection requires projectId in the WHERE on
    // VirtualKey; relation filters don't satisfy it. Resolve the
    // user's personal projects in this org first.
    const personalProjects = await this.prisma.project.findMany({
      where: {
        isPersonal: true,
        ownerUserId: userId,
        team: { organizationId },
      },
      select: { id: true },
    });
    const personalProjectIds = personalProjects.map((p) => p.id);
    if (personalProjectIds.length === 0) return [];
    return await this.prisma.virtualKey.findMany({
      where: {
        projectId: { in: personalProjectIds },
        principalUserId: userId,
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        description: true,
        displayPrefix: true,
        environment: true,
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
   * Revoke a single personal VK. Verifies the VK is owned by `userId`
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
    const vk = await this.prisma.virtualKey.findUnique({
      where: { id: virtualKeyId },
      select: {
        id: true,
        projectId: true,
        principalUserId: true,
        project: {
          select: {
            isPersonal: true,
            ownerUserId: true,
            team: { select: { organizationId: true } },
          },
        },
      },
    });
    if (
      !vk ||
      !vk.project.isPersonal ||
      vk.project.ownerUserId !== userId ||
      vk.project.team.organizationId !== organizationId
    ) {
      throw new PersonalVirtualKeyNotFoundError(virtualKeyId);
    }

    const vkService = VirtualKeyService.create(this.prisma);
    return await vkService.revoke({
      id: vk.id,
      projectId: vk.projectId,
      organizationId,
      actorUserId: userId,
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
    // Same projectId-in-WHERE constraint from dbMultiTenancyProtection
    // as `list` above — resolve the user's personal projects across
    // every org first.
    const personalProjects = await this.prisma.project.findMany({
      where: { isPersonal: true, ownerUserId: userId },
      select: { id: true },
    });
    const personalProjectIds = personalProjects.map((p) => p.id);
    if (personalProjectIds.length === 0) return 0;
    const personalVks = await this.prisma.virtualKey.findMany({
      where: {
        projectId: { in: personalProjectIds },
        principalUserId: userId,
        revokedAt: null,
      },
      select: {
        id: true,
        projectId: true,
        project: { select: { team: { select: { organizationId: true } } } },
      },
    });

    const vkService = VirtualKeyService.create(this.prisma);
    for (const vk of personalVks) {
      await vkService.revoke({
        id: vk.id,
        projectId: vk.projectId,
        organizationId: vk.project.team.organizationId,
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
 * Thrown by `issue()` when the caller relied on default-policy resolution
 * (no `routingPolicyId` argument) and the organisation has no
 * RoutingPolicy with `isDefault=true`. Routes / tRPC handlers should
 * translate this to HTTP 409 with `{ error: "no_default_routing_policy" }`
 * per specs/ai-gateway/governance/personal-keys.feature.
 */
export class NoDefaultRoutingPolicyError extends Error {
  constructor(public readonly organizationId: string) {
    super(
      `Your organization admin must publish a default routing policy before personal keys can be issued.`,
    );
    this.name = "NoDefaultRoutingPolicyError";
  }
}
