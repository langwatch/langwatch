import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { z } from "zod";

export interface CredentialSignInPolicy {
  canSignIn(args: { userId: string; email: string }): Promise<boolean>;
}

const addressSchema = z.object({ email: z.string().min(1) });
const ceremonySchema = z.object({
  challengeId: z.string().min(1),
  userId: z.string().min(1),
  email: z.string().min(1),
  expiresAtMs: z.number().int(),
});
const TWO_FACTOR_PATHS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
]);
const ceremonyIdentifier = (challengeId: string): string =>
  `sso-credential:${challengeId}`;

/** Checks the verified password's user, retaining its address through 2FA. */
export class CredentialSessionGuard {
  readonly #policy: CredentialSignInPolicy;

  constructor(policy: CredentialSignInPolicy) {
    this.#policy = policy;
  }

  async beforeSessionCreate({
    userId,
    context,
  }: {
    userId: string;
    context: GenericEndpointContext | null;
  }): Promise<void> {
    if (await this.#authorizePasskeySession({ userId, context })) return;
    if (context?.path === "/sign-in/email") {
      const { email } = addressSchema.parse(context.body);
      await this.#authorize({ userId, email });
      return;
    }
    if (!context?.path || !TWO_FACTOR_PATHS.has(context.path)) return;
    // Enrolling a second factor can rotate an already authenticated session.
    if (context.context.session?.user.id === userId) return;

    const cookie = context.context.createAuthCookie("two_factor");
    const challengeId = await context.getSignedCookie(
      cookie.name,
      context.context.secret,
    );
    if (!challengeId) throw this.#refusal();

    const saved =
      await context.context.internalAdapter.consumeVerificationValue(
        ceremonyIdentifier(challengeId),
      );
    if (!saved) throw this.#refusal();

    const ceremony = this.#parseCeremony(saved.value);
    if (
      !ceremony ||
      ceremony.userId !== userId ||
      ceremony.challengeId !== challengeId ||
      ceremony.expiresAtMs <= Date.now()
    ) {
      throw this.#refusal();
    }
    await this.#authorize({ userId, email: ceremony.email });
  }

  async #authorizePasskeySession({
    userId,
    context,
  }: {
    userId: string;
    context: GenericEndpointContext | null;
  }): Promise<boolean> {
    if (
      context?.path !== "/passkey/verify-authentication" &&
      context?.path !== "/passkey/verify-registration"
    )
      return false;
    const user = await context.context.internalAdapter.findUserById(userId);
    if (!user) throw this.#refusal();
    await this.#authorize({ userId, email: user.email });
    return true;
  }

  /**
   * Better Auth creates this challenge only after checking the password.
   * Its signed cookie names the companion, which has the same expiry and is
   * consumed before the final session. A submitted 2FA email cannot replace it.
   */
  async beforeVerificationCreate({
    verification,
    context,
  }: {
    verification: { identifier: string; value: string; expiresAt: Date };
    context: GenericEndpointContext | null;
  }): Promise<void> {
    if (
      context?.path !== "/sign-in/email" ||
      !verification.identifier.startsWith("2fa-") ||
      verification.identifier.startsWith("2fa-attempts-")
    ) {
      return;
    }

    const { email } = addressSchema.parse(context.body);
    const ceremony = ceremonySchema.parse({
      challengeId: verification.identifier,
      userId: verification.value,
      email,
      expiresAtMs: verification.expiresAt.getTime(),
    });
    await context.context.internalAdapter.createVerificationValue({
      identifier: ceremonyIdentifier(ceremony.challengeId),
      value: JSON.stringify(ceremony),
      expiresAt: verification.expiresAt,
    });
  }

  #parseCeremony(value: string): z.infer<typeof ceremonySchema> | null {
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      return null;
    }
    const result = ceremonySchema.safeParse(decoded);
    return result.success ? result.data : null;
  }

  async #authorize(args: { userId: string; email: string }): Promise<void> {
    if (!(await this.#policy.canSignIn(args))) throw this.#refusal();
  }

  #refusal(): APIError {
    return APIError.from("BAD_REQUEST", {
      code: "EMAIL_PASSWORD_DISABLED",
      message:
        "Credential sign-in is disabled — use your identity provider or a current recovery grant.",
    });
  }
}
