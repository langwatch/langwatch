import {
  cliAccessTokenKey,
  cliRefreshTokenKey,
  cliUserTokensIndexKey,
} from "@langwatch/auth-contract";
import { type CliUserInput, cliUserInputSchema } from "@langwatch/enterprise-governance-contract";
import type { CliTokenStore } from "../app/governance.infrastructure.ts";
import type { GovernanceDiagnosticsSink } from "../app/governance.infrastructure.ts";

export class DefaultGovernanceCliTokenRevocationService {
  private constructor(
    private readonly store: CliTokenStore | undefined,
    private readonly diagnostics: GovernanceDiagnosticsSink | undefined,
  ) {}

  static create(options: {
    store?: CliTokenStore;
    diagnostics?: GovernanceDiagnosticsSink;
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

    if (memberKeys.length > 0) {
      await this.store.delete(indexKey);
    }

    return { revokedCount };
  }
}
