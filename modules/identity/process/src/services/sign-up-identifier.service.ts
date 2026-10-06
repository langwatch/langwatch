import type { AttachIdentifierCommandData } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { UserRegisteredEventData } from "@langwatch/user-contract";

import { issuerForProviderId } from "../rules/better-auth-account-queries.rules.ts";
import { signUpAttachCommandId } from "../rules/identity-command-id.rules.ts";

const logger = createLogger("langwatch:identity:sign-up-identifier");

interface SignUpIdentifierServiceDeps {
  identity: { attachIdentifier(input: AttachIdentifierCommandData): Promise<unknown> };
}

/**
 * The one identity write a password sign-up owes (Q189): the credential identifier its
 * `Account` row implies, stated from the user's registered fact. The id and timestamp are
 * the committed row's own, so the backfill later states the same fact and dedupe absorbs it.
 */
export class SignUpIdentifierService {
  static create(deps: SignUpIdentifierServiceDeps): SignUpIdentifierService {
    return new SignUpIdentifierService(deps);
  }

  private constructor(private readonly deps: SignUpIdentifierServiceDeps) {}

  async attachRegistered({
    registration,
  }: {
    registration: UserRegisteredEventData;
  }): Promise<void> {
    const { userId, accountId, createdAtMs, email } = registration;
    if (!accountId || createdAtMs === undefined || !email) {
      // A fact recorded before registrations named their row: the backfill adopts the user.
      logger.debug({ userId }, "registration names no credential row; nothing to attach");
      return;
    }
    await this.deps.identity.attachIdentifier({
      tenantId: userId,
      userId,
      commandId: signUpAttachCommandId({ accountId }),
      accountId,
      provider: "credential",
      providerId: "credential",
      issuer: issuerForProviderId("credential"),
      // The credential row names the user as its own subject, as the user module writes it.
      providerAccountId: userId,
      value: email,
      occurredAtMs: createdAtMs,
      ceremony: { flow: "sign-up" },
      actor: { type: "user", id: userId },
    });
  }
}
