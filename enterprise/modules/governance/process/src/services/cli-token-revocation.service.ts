import type { AuthApi } from "@langwatch/auth-contract";
import { type CliUserInput, cliUserInputSchema } from "@langwatch/enterprise-governance-contract";

export class DefaultGovernanceCliTokenRevocationService {
  private constructor(private readonly auth: Pick<AuthApi, "revokeCliTokens">) {}

  static create(options: {
    auth: Pick<AuthApi, "revokeCliTokens">;
  }): DefaultGovernanceCliTokenRevocationService {
    return new DefaultGovernanceCliTokenRevocationService(options.auth);
  }

  revokeForUser(input: CliUserInput): Promise<{ revokedCount: number }> {
    const { userId } = cliUserInputSchema.parse(input);
    return this.auth.revokeCliTokens({ userId });
  }
}
