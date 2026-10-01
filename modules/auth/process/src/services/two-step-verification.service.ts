import { TwoStepPasswordInvalidError } from "@langwatch/auth-contract";
import type { HandledError } from "@langwatch/handled-error";
import {
  IdentityMfaCodeInvalidError,
  IdentityMfaLockedOutError,
} from "@langwatch/identity-contract";
import type { Instant } from "@langwatch/time";

import type { AuthSessionRepository } from "../repositories/auth-session.repository.ts";
import { refusedWith } from "../rules/better-auth-error-code.rules.ts";

/** better-auth's two-factor plugin, as turning it off calls it. */
export interface TwoStepProtocol {
  verifyTotp(input: { headers: Headers; code: string }): Promise<void>;
  disableTwoFactor(input: { headers: Headers; password?: string | undefined }): Promise<void>;
}

export interface TwoStepVerificationServiceDeps {
  sessions: Pick<AuthSessionRepository, "findAmrForSession" | "findAmrForIdentifiers">;
  protocol: TwoStepProtocol;
  now: () => Instant;
}

const TWO_FACTOR_REFUSALS: readonly (readonly [
  readonly string[],
  (detail: string) => HandledError,
])[] = [
  [["INVALID_CODE", "INVALID_BACKUP_CODE"], (detail) => new IdentityMfaCodeInvalidError(detail)],
  [
    ["TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", "ACCOUNT_TEMPORARILY_LOCKED"],
    (detail) => new IdentityMfaLockedOutError(detail),
  ],
];

const PASSWORD_REFUSALS = ["INVALID_PASSWORD", "INVALID_EMAIL_OR_PASSWORD"];

/** The session factors two-step verification reads, and turning it off (main's adapters). */
export class TwoStepVerificationService {
  static create(deps: TwoStepVerificationServiceDeps): TwoStepVerificationService {
    return new TwoStepVerificationService(deps);
  }

  private constructor(private readonly deps: TwoStepVerificationServiceDeps) {}

  findSessionAmr({ sessionId }: { sessionId: string }): Promise<string[]> {
    return this.deps.sessions.findAmrForSession({ sessionId });
  }

  findAssertedAmr(input: {
    userIds: readonly string[];
    identifierIds: readonly string[];
  }): Promise<string[]> {
    return this.deps.sessions.findAmrForIdentifiers({ ...input, at: this.deps.now() });
  }

  async disable({
    headers,
    password,
    code,
  }: {
    headers: Headers;
    password?: string | undefined;
    code: string;
  }): Promise<void> {
    try {
      await this.deps.protocol.verifyTotp({ headers, code });
    } catch (error) {
      throw refusalOf({
        error,
        detail: "verify_totp refused while turning two-step verification off",
      });
    }

    try {
      await this.deps.protocol.disableTwoFactor({ headers, password });
    } catch (error) {
      if (refusedWith(error, PASSWORD_REFUSALS)) {
        throw new TwoStepPasswordInvalidError(
          "disable_two_step: the password re-proof did not match",
        );
      }
      throw refusalOf({ error, detail: "disable refused while turning two-step verification off" });
    }
  }
}

function refusalOf({ error, detail }: { error: unknown; detail: string }): unknown {
  const refusal = TWO_FACTOR_REFUSALS.find(([codes]) => refusedWith(error, codes));
  return refusal ? refusal[1](detail) : error;
}
