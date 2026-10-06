// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import crypto from "node:crypto";

import {
  ScimConnectionNotFoundError,
  ScimConnectionRequiredError,
  ScimTokenNotFoundError,
  ScimTokenTooShortError,
  ScimTokenUnavailableError,
  type ScimTokenEntitlement,
  type ScimTokenSummary,
} from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { ScimRepository } from "../repositories/scim.repository.ts";
import {
  digestScimToken,
  MINIMUM_SCIM_TOKEN_LENGTH,
  scimTokenDigests,
} from "../rules/scim-token-digest.rules.ts";
import type { ScimSyncLifecycle } from "./scim-sync-lifecycle.service.ts";

const logger = createLogger("langwatch:scim:tokens");

/** A directory's bearer tokens: minted per connection, stored only as a digest, verified per push. */
export class ScimTokenService {
  static create(options: {
    repository: ScimRepository;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    lifecycle: ScimSyncLifecycle;
    tokenPepper: string | undefined;
  }): ScimTokenService {
    return new ScimTokenService(options);
  }

  private readonly repository: ScimRepository;
  private readonly entitlements: Pick<EntitlementApi, "getActivePlan">;
  private readonly lifecycle: ScimSyncLifecycle;
  private readonly tokenPepper: string | undefined;

  private constructor({
    repository,
    entitlements,
    lifecycle,
    tokenPepper,
  }: {
    repository: ScimRepository;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    lifecycle: ScimSyncLifecycle;
    tokenPepper: string | undefined;
  }) {
    this.repository = repository;
    this.entitlements = entitlements;
    this.lifecycle = lifecycle;
    this.tokenPepper = tokenPepper;
  }

  async generateToken(input: {
    organizationId: string;
    connectionId?: string | null;
    description?: string;
    secret?: string;
  }): Promise<{ token: string; tokenId: string; connectionId: string }> {
    if (!input.connectionId) {
      throw new ScimConnectionRequiredError();
    }

    const exists = await this.repository.scimConnectionExists({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    });
    if (!exists) {
      throw new ScimConnectionNotFoundError(input.connectionId);
    }

    if (input.secret !== undefined && input.secret.trim().length < MINIMUM_SCIM_TOKEN_LENGTH) {
      throw new ScimTokenTooShortError(MINIMUM_SCIM_TOKEN_LENGTH);
    }

    const token = input.secret?.trim() ?? crypto.randomBytes(32).toString("hex");
    const pepper = this.tokenHashKey();
    // Both digests: a legacy sha256 row and a new HMAC row must never name one value.
    const taken = await this.repository.findTokensByHashes(scimTokenDigests({ token, pepper }));
    if (taken.length > 0) {
      throw new ScimTokenUnavailableError();
    }

    const stored = await this.repository.createToken({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      hashedToken: digestScimToken({ token, scheme: "hmac-sha256", pepper }),
      hashScheme: "hmac-sha256",
      description: input.description ?? null,
    });
    await this.lifecycle.tokenIssued({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      tokenId: stored.id,
    });

    return { token, tokenId: stored.id, connectionId: input.connectionId };
  }

  async listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]> {
    const tokens = await this.repository.findTokens(input.organizationId);
    return tokens.map((token) => ({
      id: token.id,
      connectionId: token.connectionId,
      description: token.description,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
    }));
  }

  async revokeToken(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<{ success: true }> {
    const token = await this.repository.findToken(input);
    if (!(await this.repository.revokeToken(input))) {
      throw new ScimTokenNotFoundError(input.tokenId);
    }

    // Rotation keeps the sync live: it ends only with the connection's last token.
    const liveTokenIds = token?.connectionId
      ? await this.repository.findTokenIdsForConnection({
          organizationId: input.organizationId,
          connectionId: token.connectionId,
        })
      : [];
    if (token?.connectionId && liveTokenIds.length === 0) {
      await this.lifecycle.revoked({
        organizationId: input.organizationId,
        connectionId: token.connectionId,
        tokenId: input.tokenId,
        cause: "revoke",
      });
    }

    return { success: true };
  }

  async revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }> {
    const revoked = await this.repository.revokeTokensForConnection(input);
    // A retired connection lets its people go, so a successor may provision them.
    await this.repository.releaseDirectoryPeople(input);
    await this.lifecycle.revoked({
      ...input,
      tokenId: null,
      cause: "teardown",
    });

    return { revoked };
  }

  async verifyToken(input: { token: string }): Promise<ScimTokenEntitlement> {
    const matches = await this.repository.findTokensByHashes(
      scimTokenDigests({ token: input.token, pepper: this.tokenHashKey() }),
    );
    if (matches.length > 1) {
      logger.error({ rows: matches.length }, "a presented SCIM token names more than one row");
    }
    const stored = matches.length === 1 ? matches[0] : undefined;
    if (!stored) {
      return { status: "invalid_token" };
    }

    const plan = await this.entitlements.getActivePlan({
      organizationId: stored.organizationId,
    });
    if (plan.type !== "ENTERPRISE") {
      return {
        status: "plan_not_entitled",
        organizationId: stored.organizationId,
        connectionId: stored.connectionId,
      };
    }

    return {
      status: "ok",
      id: stored.id,
      organizationId: stored.organizationId,
      connectionId: stored.connectionId,
    };
  }

  async recordTokenUse(input: { tokenId: string }): Promise<void> {
    await this.repository.recordTokenUse({ tokenId: input.tokenId, usedAt: nowInstant() });
  }

  private tokenHashKey(): string {
    if (!this.tokenPepper) {
      throw new Error("CREDENTIALS_SECRET (or NEXTAUTH_SECRET) must be set to hash SCIM tokens");
    }
    return this.tokenPepper;
  }
}
