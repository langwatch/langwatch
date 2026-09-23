import { type Instant, nowInstant, toDate } from "@langwatch/time";
import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { z } from "zod";

/** What the guard asks before a credential ceremony may mint a session. */
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
const ceremonyIdentifier = (challengeId: string): string => `sso-credential:${challengeId}`;

/**
 * Checks the verified password's user against the route its address takes,
 * retaining that proved address through a second factor
 * (specs/identity/sso-credential-enforcement.feature).
 */
export class CredentialSessionGuard {
  static create(policy: CredentialSignInPolicy): CredentialSessionGuard {
    return new CredentialSessionGuard(policy);
  }

  private constructor(private readonly policy: CredentialSignInPolicy) {}

  async beforeSessionCreate({
    userId,
    context,
  }: {
    userId: string;
    context: GenericEndpointContext | null;
  }): Promise<void> {
    if (await this.authorizePasskeySession({ userId, context })) return;
    if (context?.path === "/sign-in/email") {
      const { email } = addressSchema.parse(context.body);
      await this.authorize({ userId, email });
      return;
    }
    if (!context?.path || !TWO_FACTOR_PATHS.has(context.path)) return;
    // Enrolling a second factor can rotate an already authenticated session.
    if (context.context.session?.user.id === userId) return;

    const cookie = context.context.createAuthCookie("two_factor");
    const challengeId = await context.getSignedCookie(cookie.name, context.context.secret);
    if (!challengeId) throw this.refusal();

    const saved = await context.context.internalAdapter.consumeVerificationValue(
      ceremonyIdentifier(challengeId),
    );
    if (!saved) throw this.refusal();

    const ceremony = this.parseCeremony(saved.value);
    if (
      !ceremony ||
      ceremony.userId !== userId ||
      ceremony.challengeId !== challengeId ||
      ceremony.expiresAtMs <= nowInstant().epochMilliseconds
    ) {
      throw this.refusal();
    }
    await this.authorize({ userId, email: ceremony.email });
  }

  /** Better Auth creates this challenge only after checking the password; its
   *  signed cookie names the companion, consumed before the final session, so
   *  a submitted address cannot replace the proved one. */
  async beforeVerificationCreate({
    verification,
    context,
  }: {
    verification: { identifier: string; value: string; expiresAt: Instant };
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
      expiresAtMs: verification.expiresAt.epochMilliseconds,
    });
    await context.context.internalAdapter.createVerificationValue({
      identifier: ceremonyIdentifier(ceremony.challengeId),
      value: JSON.stringify(ceremony),
      expiresAt: toDate(verification.expiresAt),
    });
  }

  private async authorizePasskeySession({
    userId,
    context,
  }: {
    userId: string;
    context: GenericEndpointContext | null;
  }): Promise<boolean> {
    if (
      context?.path !== "/passkey/verify-authentication" &&
      context?.path !== "/passkey/verify-registration"
    ) {
      return false;
    }
    const user = await context.context.internalAdapter.findUserById(userId);
    if (!user) throw this.refusal();
    await this.authorize({ userId, email: user.email });
    return true;
  }

  private parseCeremony(value: string): z.infer<typeof ceremonySchema> | null {
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      return null;
    }
    const result = ceremonySchema.safeParse(decoded);
    return result.success ? result.data : null;
  }

  private async authorize(args: { userId: string; email: string }): Promise<void> {
    if (!(await this.policy.canSignIn(args))) throw this.refusal();
  }

  private refusal(): APIError {
    return APIError.from("BAD_REQUEST", {
      code: "EMAIL_PASSWORD_DISABLED",
      message:
        "Credential sign-in is disabled - use your identity provider or a current recovery grant.",
    });
  }
}
