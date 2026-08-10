// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { isEnterpriseTier } from "~/server/api/enterprise";
import { getApp } from "~/server/app-layer/app";
import type { PlanProvider } from "~/server/app-layer/subscription/plan-provider";
import { ScimTokenNotFoundError } from "./errors";

/**
 * The three answers a bearer credential can get from {@link ScimTokenService.verifyEntitled}:
 * the token is unknown, the token is real but the organization's plan no
 * longer includes SCIM, or both checks passed. Discriminated so the SCIM
 * boundary can answer 401 and 403 differently: an identity provider retrying
 * a 401 forever is a different incident from one that must be told the plan
 * lapsed.
 */
export type ScimTokenEntitlement =
  | { status: "invalid_token" }
  | { status: "plan_not_entitled"; organizationId: string }
  | { status: "ok"; organizationId: string };

/**
 * Manages SCIM bearer tokens: generation, hashing, and verification.
 * Each token is scoped to a single organization.
 *
 * `planProvider` is injectable for tests; it defaults lazily to the app's own
 * (the InviteService pattern), so production callers keep constructing with
 * just Prisma.
 */
export class ScimTokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly deps: { planProvider?: PlanProvider } = {},
  ) {}

  static create(
    prisma: PrismaClient,
    deps: { planProvider?: PlanProvider } = {},
  ): ScimTokenService {
    return new ScimTokenService(prisma, deps);
  }

  private get planProvider(): PlanProvider {
    return this.deps.planProvider ?? getApp().planProvider;
  }

  /**
   * Generates a new SCIM token for the given organization.
   * Returns the plaintext token (shown once) and stores the SHA-256 hash.
   */
  async generate({
    organizationId,
    description,
  }: {
    organizationId: string;
    description?: string;
  }): Promise<{ token: string; tokenId: string }> {
    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = this.hashToken(token);

    const scimToken = await this.prisma.scimToken.create({
      data: {
        organizationId,
        hashedToken,
        description: description ?? null,
      },
    });

    return { token, tokenId: scimToken.id };
  }

  /**
   * The organization's SCIM tokens as the management surfaces list them.
   * Never returns the stored hash, let alone a token: the plaintext exists
   * only in the {@link generate} response, once.
   */
  async list({ organizationId }: { organizationId: string }): Promise<
    Array<{
      id: string;
      description: string | null;
      createdAt: Date;
      lastUsedAt: Date | null;
    }>
  > {
    return this.prisma.scimToken.findMany({
      where: { organizationId },
      select: {
        id: true,
        description: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Deletes a token so it stops verifying. Organization-scoped: a token id
   * from another organization reads as not found, and so does an
   * already-revoked one, which keeps revocation idempotent for a
   * provisioning tool.
   */
  async revoke({
    organizationId,
    tokenId,
  }: {
    organizationId: string;
    tokenId: string;
  }): Promise<{ success: true }> {
    // A single deleteMany keeps revocation atomic: a find-then-delete pair
    // lets a concurrent or retried revoke land between the two statements
    // and surface as a raw Prisma P2025 instead of the stable code.
    const { count } = await this.prisma.scimToken.deleteMany({
      where: { id: tokenId, organizationId },
    });
    if (count === 0) {
      throw new ScimTokenNotFoundError(tokenId);
    }
    return { success: true };
  }

  /**
   * Verifies a bearer token and returns the associated organization ID.
   * Updates lastUsedAt on successful verification.
   */
  async verify({
    token,
  }: {
    token: string;
  }): Promise<{ organizationId: string } | null> {
    const scimToken = await this.findByToken(token);

    if (!scimToken) {
      return null;
    }

    await this.recordUse(scimToken.id);

    return { organizationId: scimToken.organizationId };
  }

  /**
   * {@link verify}, plus the entitlement the token was minted under.
   *
   * A SCIM token is checked on every directory-sync call, so this is the
   * point where a lapsed plan takes effect: without it, an organization that
   * leaves Enterprise keeps a working sync for as long as the token lives,
   * quietly outliving the entitlement it was sold under. The SCIM boundary
   * calls this instead of `verify` and turns `plan_not_entitled` into a
   * SCIM-shaped 403.
   *
   * `lastUsedAt` is written only once the plan entitles the call, so the token
   * list an administrator reads during a plan lapse does not show a refused
   * credential as recently used.
   */
  async verifyEntitled({
    token,
  }: {
    token: string;
  }): Promise<ScimTokenEntitlement> {
    const scimToken = await this.findByToken(token);
    if (!scimToken) {
      return { status: "invalid_token" };
    }

    const { id, organizationId } = scimToken;
    const plan = await this.planProvider.getActivePlan({ organizationId });

    if (!isEnterpriseTier(plan.type)) {
      return { status: "plan_not_entitled", organizationId };
    }

    await this.recordUse(id);

    return { status: "ok", organizationId };
  }

  private findByToken(token: string) {
    return this.prisma.scimToken.findFirst({
      where: { hashedToken: this.hashToken(token) },
    });
  }

  /**
   * `updateMany`, for the same reason {@link revoke} uses `deleteMany`: an
   * administrator revoking a token while the identity provider is mid-sync
   * deletes the row between {@link findByToken} and this write, and `update`
   * would turn that ordinary race into a P2025 the SCIM boundary can only
   * answer as a 500. A missing row updates nothing and the call carries on to
   * the refusal the credential has already earned.
   */
  private async recordUse(tokenId: string): Promise<void> {
    await this.prisma.scimToken.updateMany({
      where: { id: tokenId },
      data: { lastUsedAt: new Date() },
    });
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
