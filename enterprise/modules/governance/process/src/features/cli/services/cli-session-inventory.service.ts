import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthApi, CliTokenRecordEntry } from "@langwatch/auth-contract";
import {
  type CliSession,
  type CliUserInput,
  type RevokeCliSessionInput,
  cliUserInputSchema,
  revokeCliSessionInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:governance:cli-session-inventory");

type CliTokenAuth = Pick<AuthApi, "findCliTokenRecordsForUser" | "revokeCliTokens">;
type CliLoginKeys = Pick<ApiKeyApi, "revokeCliSessionKey">;
type SessionRevocation = { revokedTokens: number; revokedKeys: number };

export class DefaultGovernanceCliSessionInventoryService {
  private constructor(
    private readonly auth: CliTokenAuth,
    private readonly loginKeys: CliLoginKeys,
  ) {}

  static create(options: {
    auth: CliTokenAuth;
    loginKeys: CliLoginKeys;
  }): DefaultGovernanceCliSessionInventoryService {
    return new DefaultGovernanceCliSessionInventoryService(options.auth, options.loginKeys);
  }

  async listForUser(input: CliUserInput): Promise<CliSession[]> {
    const parsed = cliUserInputSchema.parse(input);
    const records = await this.auth.findCliTokenRecordsForUser({ userId: parsed.userId });
    const buckets = new Map<number, { tokenKeys: string[]; records: CliTokenRecordEntry[] }>();
    for (const record of records) {
      const anchor = record.clientInfo?.sessionStartedAtMs ?? record.issuedAtMs;
      const bucket = buckets.get(anchor) ?? { tokenKeys: [], records: [] };
      bucket.tokenKeys.push(record.tokenKey);
      bucket.records.push(record);
      buckets.set(anchor, bucket);
    }

    return [...buckets.entries()]
      .map(([sessionStartedAtMs, bucket]) => {
        const fresh = bucket.records.reduce((left, right) =>
          left.issuedAtMs >= right.issuedAtMs ? left : right,
        );

        return {
          sessionStartedAtMs,
          deviceLabel: this.deviceLabel(fresh.clientInfo),
          hostname: fresh.clientInfo?.hostname ?? null,
          uname: fresh.clientInfo?.uname ?? null,
          platform: fresh.clientInfo?.platform ?? null,
          organizationId: fresh.organizationId,
          cliApiKeyId: bucket.records.find((record) => record.cliApiKeyId)?.cliApiKeyId ?? null,
          lastSeenMs: Math.max(...bucket.records.map(({ issuedAtMs }) => issuedAtMs)),
          expiresAtMs: Math.max(...bucket.records.map(({ expiresAtMs }) => expiresAtMs)),
          tokenKeys: bucket.tokenKeys,
        };
      })
      .toSorted((left, right) => right.lastSeenMs - left.lastSeenMs);
  }

  async revokeSession(input: RevokeCliSessionInput): Promise<SessionRevocation> {
    const parsed = revokeCliSessionInputSchema.parse(input);
    const sessions = await this.listForUser({ userId: parsed.userId });
    const target = sessions.find(
      ({ sessionStartedAtMs }) => sessionStartedAtMs === parsed.sessionStartedAtMs,
    );
    if (!target) return { revokedTokens: 0, revokedKeys: 0 };

    const revokedKeys = await this.revokeLoginKey({ userId: parsed.userId, session: target });
    const { revokedCount } = await this.auth.revokeCliTokens({
      userId: parsed.userId,
      tokenKeys: target.tokenKeys,
    });
    return { revokedTokens: revokedCount, revokedKeys };
  }

  /** Every CLI session the person holds: each login key, then every token. */
  async revokeAllSessions(input: CliUserInput): Promise<SessionRevocation> {
    const parsed = cliUserInputSchema.parse(input);
    let revokedKeys = 0;
    for (const session of await this.listForUser({ userId: parsed.userId })) {
      revokedKeys += await this.revokeLoginKey({ userId: parsed.userId, session });
    }
    const { revokedCount } = await this.auth.revokeCliTokens({ userId: parsed.userId });
    return { revokedTokens: revokedCount, revokedKeys };
  }

  /** A login key that cannot be retired never fails the session's revoke, as on main. */
  private async revokeLoginKey({
    userId,
    session,
  }: {
    userId: string;
    session: CliSession;
  }): Promise<number> {
    if (!session.cliApiKeyId) return 0;
    try {
      const result = await this.loginKeys.revokeCliSessionKey({
        apiKeyId: session.cliApiKeyId,
        userId,
        organizationId: session.organizationId,
      });
      return (result.loginKeyRevoked ? 1 : 0) + result.ingestKeysRevoked;
    } catch (error) {
      logger.warn(
        { error, userId, apiKeyId: session.cliApiKeyId },
        "could not revoke the login key of a revoked CLI session",
      );
      return 0;
    }
  }

  private deviceLabel(info: CliTokenRecordEntry["clientInfo"]): string {
    if (info?.deviceLabel?.trim()) {
      return info.deviceLabel.trim();
    }

    const platform = this.mapPlatformName(info?.platform);
    const host = info?.hostname?.trim();
    if (host && platform) {
      return `${platform} (${host})`;
    }

    return host || platform || "Unknown device";
  }

  private mapPlatformName(platform: string | undefined): string | undefined {
    if (!platform) {
      return undefined;
    }

    switch (platform.toLowerCase()) {
      case "darwin":
        return "Mac";
      case "linux":
        return "Linux";
      case "win32":
      case "windows":
        return "Windows";
      default:
        return platform;
    }
  }
}
