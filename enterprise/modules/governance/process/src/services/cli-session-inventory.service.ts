import type { AuthApi, CliTokenRecordEntry } from "@langwatch/auth-contract";
import {
  type CliSession,
  type CliUserInput,
  type RevokeCliSessionInput,
  cliUserInputSchema,
  revokeCliSessionInputSchema,
} from "@langwatch/enterprise-governance-contract";

type CliTokenAuth = Pick<AuthApi, "findCliTokenRecordsForUser" | "revokeCliTokens">;

export class DefaultGovernanceCliSessionInventoryService {
  private constructor(private readonly auth: CliTokenAuth) {}

  static create(options: { auth: CliTokenAuth }): DefaultGovernanceCliSessionInventoryService {
    return new DefaultGovernanceCliSessionInventoryService(options.auth);
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
          lastSeenMs: Math.max(...bucket.records.map(({ issuedAtMs }) => issuedAtMs)),
          expiresAtMs: Math.max(...bucket.records.map(({ expiresAtMs }) => expiresAtMs)),
          tokenKeys: bucket.tokenKeys,
        };
      })
      .toSorted((left, right) => right.lastSeenMs - left.lastSeenMs);
  }

  async revokeSession(input: RevokeCliSessionInput): Promise<{ revokedTokens: number }> {
    const parsed = revokeCliSessionInputSchema.parse(input);
    const sessions = await this.listForUser({ userId: parsed.userId });
    const target = sessions.find(
      ({ sessionStartedAtMs }) => sessionStartedAtMs === parsed.sessionStartedAtMs,
    );
    if (!target) {
      return { revokedTokens: 0 };
    }

    const { revokedCount } = await this.auth.revokeCliTokens({
      userId: parsed.userId,
      tokenKeys: target.tokenKeys,
    });
    return { revokedTokens: revokedCount };
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
