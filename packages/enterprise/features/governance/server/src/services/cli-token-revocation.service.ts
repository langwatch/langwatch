import {
  type CliUserInput,
  cliAccessTokenKey,
  cliRefreshTokenKey,
  cliUserInputSchema,
  cliUserTokensIndexKey,
} from "@langwatch/enterprise-governance-contract";
import type { CliTokenStorePort } from "../ports/cli-token-store.port";
import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port";

export class DefaultGovernanceCliTokenRevocationService {
  private constructor(
    private readonly store: CliTokenStorePort | undefined,
    private readonly diagnostics: GovernanceDiagnosticsPort | undefined,
  ) {}

  static create(options: {
    store?: CliTokenStorePort;
    diagnostics?: GovernanceDiagnosticsPort;
  }): DefaultGovernanceCliTokenRevocationService {
    return new DefaultGovernanceCliTokenRevocationService(options.store, options.diagnostics);
  }

  static userTokensIndexKey = cliUserTokensIndexKey;
  static accessTokenKey = cliAccessTokenKey;
  static refreshTokenKey = cliRefreshTokenKey;

  async revokeForUser(input: CliUserInput): Promise<{ revokedCount: number }> {
    const parsed = cliUserInputSchema.parse(input);
    if (!this.store) {
      this.diagnostics?.warn("CLI token store is unavailable — skipping token revocation", {
        userId: parsed.userId,
      });
      return { revokedCount: 0 };
    }

    const indexKey = cliUserTokensIndexKey(parsed.userId);
    const memberKeys = await this.store.members(indexKey);
    let revokedCount = 0;
    for (const memberKey of memberKeys) {
      revokedCount += await this.store.delete(memberKey);
    }
    if (memberKeys.length > 0) await this.store.delete(indexKey);
    return { revokedCount };
  }
}
