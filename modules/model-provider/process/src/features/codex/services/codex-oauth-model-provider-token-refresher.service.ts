import { CodexAuthError, type CodexTokenKeys } from "@langwatch/model-provider-contract";

import { CodexAccountService } from "./codex-account.service.ts";

/** OAuth exchange boundary owned by the application runtime. */
export abstract class CodexTokenRefresher {
  abstract refresh(input: {
    tokens: CodexTokenKeys;
  }): Promise<{ status: "refreshed"; tokens: CodexTokenKeys } | { status: "session_expired" }>;
}

/**
 * The Codex refresher, over the device-flow account service above.
 */
export class CodexOAuthModelProviderTokenRefresherService extends CodexTokenRefresher {
  static create(input: { issuer?: string } = {}): CodexOAuthModelProviderTokenRefresherService {
    return new CodexOAuthModelProviderTokenRefresherService(
      CodexAccountService.create({ issuer: input.issuer }),
    );
  }

  private constructor(private readonly account: CodexAccountService) {
    super();
  }

  async refresh(input: {
    tokens: CodexTokenKeys;
  }): Promise<{ status: "refreshed"; tokens: CodexTokenKeys } | { status: "session_expired" }> {
    try {
      const tokens = await this.account.refresh(input.tokens);
      return { status: "refreshed", tokens };
    } catch (error) {
      if (error instanceof CodexAuthError && error.kind === "refresh_rejected") {
        return { status: "session_expired" };
      }
      throw error;
    }
  }
}
