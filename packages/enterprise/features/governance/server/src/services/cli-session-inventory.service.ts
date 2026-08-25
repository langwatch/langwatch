import {
  GovernanceCliSessionInventoryService,
  type CliSession,
  type CliTokenRecord,
  type CliUserInput,
  type RevokeCliSessionInput,
  cliTokenRecordSchema,
  cliUserInputSchema,
  cliUserTokensIndexKey,
  revokeCliSessionInputSchema,
} from "@langwatch/enterprise-governance-contract";
import type { CliTokenStorePort } from "../ports/cli-token-store.port";
import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port";

export class DefaultGovernanceCliSessionInventoryService extends GovernanceCliSessionInventoryService {
  private constructor(
    private readonly store: CliTokenStorePort | undefined,
    private readonly diagnostics: GovernanceDiagnosticsPort | undefined,
  ) {
    super();
  }

  static create(options: {
    store?: CliTokenStorePort;
    diagnostics?: GovernanceDiagnosticsPort;
  }): DefaultGovernanceCliSessionInventoryService {
    return new DefaultGovernanceCliSessionInventoryService(
      options.store,
      options.diagnostics,
    );
  }

  async listForUser(input: CliUserInput): Promise<CliSession[]> {
    const parsed = cliUserInputSchema.parse(input);
    if (!this.store) {
      this.diagnostics?.warn("CLI token store is unavailable", {
        userId: parsed.userId,
      });
      return [];
    }

    const memberKeys = await this.store.members(
      cliUserTokensIndexKey(parsed.userId),
    );
    const buckets = new Map<
      number,
      { tokenKeys: string[]; records: CliTokenRecord[] }
    >();
    for (const memberKey of memberKeys) {
      const raw = await this.store.tryGet(memberKey);
      if (!raw) continue;
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        continue;
      }
      const result = cliTokenRecordSchema.safeParse(json);
      if (!result.success || result.data.user_id !== parsed.userId) continue;
      const record = result.data;
      const anchor = record.client_info?.session_started_at ?? record.issued_at;
      const bucket = buckets.get(anchor) ?? { tokenKeys: [], records: [] };
      bucket.tokenKeys.push(memberKey);
      bucket.records.push(record);
      buckets.set(anchor, bucket);
    }

    return [...buckets.entries()]
      .map(([sessionStartedAtMs, bucket]) => {
        const fresh = bucket.records.reduce((left, right) =>
          left.issued_at >= right.issued_at ? left : right,
        );
        return {
          sessionStartedAtMs,
          deviceLabel: this.deviceLabel(fresh.client_info),
          hostname: fresh.client_info?.hostname ?? null,
          uname: fresh.client_info?.uname ?? null,
          platform: fresh.client_info?.platform ?? null,
          lastSeenMs: Math.max(
            ...bucket.records.map(({ issued_at }) => issued_at),
          ),
          expiresAtMs: Math.max(
            ...bucket.records.map(({ expires_at }) => expires_at),
          ),
          tokenKeys: bucket.tokenKeys,
        };
      })
      .sort((left, right) => right.lastSeenMs - left.lastSeenMs);
  }

  async revokeSession(
    input: RevokeCliSessionInput,
  ): Promise<{ revokedTokens: number }> {
    const parsed = revokeCliSessionInputSchema.parse(input);
    if (!this.store) return { revokedTokens: 0 };
    const sessions = await this.listForUser({ userId: parsed.userId });
    const target = sessions.find(
      ({ sessionStartedAtMs }) =>
        sessionStartedAtMs === parsed.sessionStartedAtMs,
    );
    if (!target) return { revokedTokens: 0 };

    let revokedTokens = 0;
    for (const tokenKey of target.tokenKeys) {
      revokedTokens += await this.store.delete(tokenKey);
    }
    if (target.tokenKeys.length > 0) {
      await this.store.removeMembers(
        cliUserTokensIndexKey(parsed.userId),
        target.tokenKeys,
      );
    }
    return { revokedTokens };
  }

  private deviceLabel(info: CliTokenRecord["client_info"]): string {
    if (info?.device_label?.trim()) return info.device_label.trim();
    const platform = this.tryPlatformName(info?.platform);
    const host = info?.hostname?.trim();
    if (host && platform) return `${platform} (${host})`;
    return host || platform || "Unknown device";
  }

  private tryPlatformName(platform: string | undefined): string | null {
    if (!platform) return null;
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
