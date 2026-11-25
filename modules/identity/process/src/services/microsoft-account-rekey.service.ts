import { createLogger, type Logger } from "@langwatch/observability";

import type { IdentityAccountRekeyRepository } from "../repositories/identity-account-rekey.repository.ts";
import { readMicrosoftAccountKeyMove } from "../rules/microsoft-account-key-move.rules.ts";

/**
 * Moves a pre-3.17 Azure AD account onto the key better-auth 1.7 looks it up by, from the id
 * token of the sign-in, before that lookup runs (specs/auth/azure-ad-account-upgrade.feature).
 * A failed move stops the sign-in rather than letting it fall through to account linking.
 */
export class MicrosoftAccountRekeyService {
  static create({
    accounts,
    logger = createLogger("langwatch:identity:microsoft-account-rekey"),
  }: {
    accounts: IdentityAccountRekeyRepository;
    logger?: Logger;
  }): MicrosoftAccountRekeyService {
    return new MicrosoftAccountRekeyService(accounts, logger);
  }

  private constructor(
    private readonly accounts: IdentityAccountRekeyRepository,
    private readonly logger: Logger,
  ) {}

  async moveOnSignIn({ profile }: { profile: Readonly<Record<string, unknown>> }): Promise<void> {
    const move = readMicrosoftAccountKeyMove(profile);
    if (move.kind === "none") return;
    try {
      const result = await this.accounts.moveLegacyMicrosoftAccount(move);
      if (result === "rekeyed") {
        this.logger.info(
          { issuer: move.issuer },
          "moved a pre-3.17 Microsoft account onto its better-auth 1.7 key",
        );
      }
    } catch (error) {
      this.logger.error(
        { error },
        "could not move a pre-3.17 Microsoft account onto its better-auth 1.7 key; the sign-in is stopped",
      );
      throw error;
    }
  }
}
