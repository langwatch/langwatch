// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import crypto from "node:crypto";
import {
  ScimTokenCapability,
  type ScimTokenEntitlement,
  ScimTokenNotFoundError,
  type ScimTokenRecord,
} from "@langwatch/enterprise-scim-contract";

export abstract class ScimTokenRepository {
  abstract create(input: {
    organizationId: string;
    hashedToken: string;
    description: string | null;
  }): Promise<{ id: string }>;
  abstract list(organizationId: string): Promise<
    Array<Pick<ScimTokenRecord, "id" | "description" | "createdAt" | "lastUsedAt">>
  >;
  abstract revoke(input: { organizationId: string; tokenId: string }): Promise<boolean>;
  abstract tryFindByHash(hashedToken: string): Promise<
    Pick<ScimTokenRecord, "id" | "organizationId"> | null
  >;
  abstract recordUse(tokenId: string, usedAt: Date): Promise<void>;
}

export abstract class ScimEntitlementProvider {
  abstract isEntitled(organizationId: string): Promise<boolean>;
}

export interface ScimTokenServiceOptions {
  repository: ScimTokenRepository;
  entitlements: ScimEntitlementProvider;
  now?: (() => Date) | undefined;
  generateToken?: (() => string) | undefined;
}

export class ScimTokenService extends ScimTokenCapability {
  private constructor(
    private readonly repository: ScimTokenRepository,
    private readonly entitlements: ScimEntitlementProvider,
    private readonly now: () => Date,
    private readonly generateTokenValue: () => string,
  ) {
    super();
  }

  static create(options: ScimTokenServiceOptions): ScimTokenService {
    return new ScimTokenService(
      options.repository,
      options.entitlements,
      options.now ?? (() => new Date()),
      options.generateToken ?? (() => crypto.randomBytes(32).toString("hex")),
    );
  }

  async generate(input: {
    organizationId: string;
    description?: string | undefined;
  }): Promise<{ token: string; tokenId: string }> {
    const token = this.generateTokenValue();
    const stored = await this.repository.create({
      organizationId: input.organizationId,
      hashedToken: this.hashToken(token),
      description: input.description ?? null,
    });
    return { token, tokenId: stored.id };
  }

  list(input: {
    organizationId: string;
  }): ReturnType<ScimTokenCapability["list"]> {
    return this.repository.list(input.organizationId);
  }

  async revoke(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<{ success: true }> {
    const revoked = await this.repository.revoke(input);
    if (!revoked) throw new ScimTokenNotFoundError(input.tokenId);
    return { success: true };
  }

  async tryVerify(input: {
    token: string;
  }): Promise<{ organizationId: string } | null> {
    const stored = await this.repository.tryFindByHash(this.hashToken(input.token));
    if (!stored) return null;
    await this.repository.recordUse(stored.id, this.now());
    return { organizationId: stored.organizationId };
  }

  async verifyEntitled(input: { token: string }): Promise<ScimTokenEntitlement> {
    const stored = await this.repository.tryFindByHash(this.hashToken(input.token));
    if (!stored) return { status: "invalid_token" };
    if (!(await this.entitlements.isEntitled(stored.organizationId))) {
      return {
        status: "plan_not_entitled",
        organizationId: stored.organizationId,
      };
    }
    await this.repository.recordUse(stored.id, this.now());
    return { status: "ok", organizationId: stored.organizationId };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
