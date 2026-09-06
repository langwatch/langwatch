// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import crypto from "crypto";
import type { PrismaClient } from "~/generated/prisma/client";
import { isEnterpriseTier } from "~/server/api/enterprise";
import { getApp } from "~/server/app-layer/app";
import type { PlanProvider } from "~/server/app-layer/subscription/plan-provider";
import {
  ScimConnectionNotFoundError,
  ScimConnectionRequiredError,
  ScimTokenNotFoundError,
} from "./errors";
import { scimSyncLifecycle } from "./scim-sync.runtime";
import type { ScimSyncLifecycle } from "./scim-sync.service";

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
  | {
      status: "ok";
      organizationId: string;
      /**
       * The connection this token was issued for, and the whole of its write
       * authority (D08). Null only for a token minted before connection
       * scoping whose organization has no connection to have been backfilled
       * onto — such a token keeps the organization-wide authority it was sold
       * with, and every new token has one.
       */
      connectionId: string | null;
    };

/**
 * Manages SCIM bearer tokens: generation, hashing, and verification.
 * Each token is scoped to a single organization.
 *
 * `planProvider` is injectable for tests; it defaults lazily to the app's own
 * (the InviteService pattern), so production callers keep constructing with
 * just Prisma.
 */
export type ScimTokenServiceDeps = {
  planProvider?: PlanProvider;
  /** The directory-sync history a mint and a revoke state facts on (D08).
   *  Composed lazily so production callers keep constructing with Prisma. */
  syncLifecycle?: ScimSyncLifecycle;
};

export class ScimTokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly deps: ScimTokenServiceDeps = {},
  ) {}

  static create(
    prisma: PrismaClient,
    deps: ScimTokenServiceDeps = {},
  ): ScimTokenService {
    return new ScimTokenService(prisma, deps);
  }

  private get planProvider(): PlanProvider {
    return this.deps.planProvider ?? getApp().planProvider;
  }

  private get syncLifecycle(): ScimSyncLifecycle {
    return this.deps.syncLifecycle ?? scimSyncLifecycle(this.prisma);
  }

  /**
   * Mints a SCIM token for one connection of the given organization.
   * Returns the plaintext token (shown once) and stores the SHA-256 hash.
   *
   * The connection is required and verified against the organization before
   * anything is written (D08). It is the token's entire write authority, so
   * defaulting it would hand out authority nobody asked for, and accepting an
   * unverified one would let a caller mint a credential against another
   * organization's connection. A connection this organization does not have
   * reads as not found whether it belongs to somebody else or to nobody, so
   * the refusal confirms nothing about another customer.
   *
   * Minting also starts the connection's directory-sync history — the point
   * `TOKEN_ISSUED` names — so a connection wired up and never pushed to is
   * distinguishable from one that never got a token.
   */
  async generate({
    organizationId,
    connectionId,
    description,
  }: {
    organizationId: string;
    connectionId?: string | null;
    description?: string;
  }): Promise<{ token: string; tokenId: string; connectionId: string }> {
    if (!connectionId) {
      throw new ScimConnectionRequiredError();
    }
    const connection = await this.prisma.ssoConnection.findFirst({
      where: { id: connectionId, organizationId },
      select: { id: true },
    });
    if (!connection) {
      throw new ScimConnectionNotFoundError(connectionId);
    }

    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = this.hashToken(token);

    const scimToken = await this.prisma.scimToken.create({
      data: {
        organizationId,
        connectionId,
        hashedToken,
        description: description ?? null,
      },
    });

    await this.syncLifecycle.tokenIssued({
      organizationId,
      connectionId,
      tokenId: scimToken.id,
    });

    return { token, tokenId: scimToken.id, connectionId };
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
      connectionId: string | null;
      createdAt: Date;
      lastUsedAt: Date | null;
    }>
  > {
    return this.prisma.scimToken.findMany({
      where: { organizationId },
      select: {
        id: true,
        description: true,
        // Which connection a token reaches is the most important thing about
        // it, so the management surfaces show it. It is an id, not a secret.
        connectionId: true,
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
    // Read the connection BEFORE the delete: once the row is gone there is
    // nothing left to say which sync just ended, and a revoke whose history
    // says nothing is a revoke nobody can check afterwards.
    const revoked = await this.prisma.scimToken.findFirst({
      where: { id: tokenId, organizationId },
      select: { connectionId: true },
    });
    // A single deleteMany keeps revocation atomic: a find-then-delete pair
    // lets a concurrent or retried revoke land between the two statements
    // and surface as a raw Prisma P2025 instead of the stable code.
    const { count } = await this.prisma.scimToken.deleteMany({
      where: { id: tokenId, organizationId },
    });
    if (count === 0) {
      throw new ScimTokenNotFoundError(tokenId);
    }
    if (revoked?.connectionId) {
      await this.syncLifecycle.revoked({
        organizationId,
        connectionId: revoked.connectionId,
        tokenId,
        cause: "revoke",
      });
    }
    return { success: true };
  }

  /**
   * Every token issued for a connection stops verifying, because the
   * connection it was issued against is gone (D08: "Tearing a connection down
   * ends its tokens"). Called by the connection teardown path, not by an
   * administrator: a torn-down connection whose tokens still verified would
   * be a directory writing into an organization that no longer trusts it.
   *
   * Answers how many it revoked, so teardown can say what it took with it.
   * Every other connection's tokens are untouched — the `where` is the whole
   * of that guarantee.
   */
  async revokeForConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }> {
    const { count } = await this.prisma.scimToken.deleteMany({
      where: { organizationId, connectionId },
    });
    // Stated even when no token existed: a connection torn down before
    // anyone minted one still ended its sync, and a projection that stayed
    // TOKEN_ISSUED would read as a setup somebody could still finish.
    await this.syncLifecycle.revoked({
      organizationId,
      connectionId,
      tokenId: null,
      cause: "teardown",
    });
    return { revoked: count };
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

    const { id, organizationId, connectionId } = scimToken;
    const plan = await this.planProvider.getActivePlan({ organizationId });

    if (!isEnterpriseTier(plan.type)) {
      return { status: "plan_not_entitled", organizationId };
    }

    await this.recordUse(id);

    return { status: "ok", organizationId, connectionId };
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
