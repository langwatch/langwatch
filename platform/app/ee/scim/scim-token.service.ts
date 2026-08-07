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
    const token = await this.prisma.scimToken.findFirst({
      where: { id: tokenId, organizationId },
      select: { id: true },
    });
    if (!token) {
      throw new ScimTokenNotFoundError(tokenId);
    }
    await this.prisma.scimToken.delete({
      where: { id: tokenId, organizationId },
    });
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
    const hashedToken = this.hashToken(token);

    const scimToken = await this.prisma.scimToken.findFirst({
      where: { hashedToken },
    });

    if (!scimToken) {
      return null;
    }

    await this.prisma.scimToken.update({
      where: { id: scimToken.id },
      data: { lastUsedAt: new Date() },
    });

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
   */
  async verifyEntitled({
    token,
  }: {
    token: string;
  }): Promise<ScimTokenEntitlement> {
    const verified = await this.verify({ token });
    if (!verified) {
      return { status: "invalid_token" };
    }

    const plan = await this.planProvider.getActivePlan({
      organizationId: verified.organizationId,
    });

    if (!isEnterpriseTier(plan.type)) {
      return {
        status: "plan_not_entitled",
        organizationId: verified.organizationId,
      };
    }

    return { status: "ok", organizationId: verified.organizationId };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
