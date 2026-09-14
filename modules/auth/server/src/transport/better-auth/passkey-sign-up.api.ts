import { createHmac } from "node:crypto";
import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { UserApi } from "@langwatch/user-contract";
import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import type { BetterAuthAnnouncements } from "./better-auth.collaborators.ts";

/** Everything the passkey ceremony asks of the user directory. */
export type PasskeySignUpDirectory = Pick<UserApi, "findByEmail" | "createPasskeyUser">;

/**
 * What passkey sign-up needs from sign-up's address confirmation.
 *
 * Named here rather than taken from the identity package because the process
 * that composes better-auth owns the identity services and their wiring: a
 * consumer that names the one method it calls needs nothing else.
 */
export interface SignUpVerification {
  requestVerification(input: { email: string }): Promise<void>;
}

const logger = createLogger("langwatch:better-auth:passkey-signup");

/**
 * The code the sign-up screen watches for, so an address that already has an
 * account turns the screen into the log-in one rather than reporting a failed
 * ceremony. Refused BEFORE the ceremony, which is why no system prompt opens
 * for it.
 */
export const PASSKEY_SIGNUP_EMAIL_TAKEN = "EMAIL_ALREADY_REGISTERED";

/** The code for an address the endpoint will not accept at all. */
export const PASSKEY_SIGNUP_EMAIL_INVALID = "INVALID_EMAIL";

/**
 * Account creation WITH passkey. Requires no session and account created only
 * on success. Public endpoints (requireSession: false) secured by resolveUser
 * check, address duplicate prevention, and rate limiting.
 */

/**
 * WebAuthn user handle for unauthenticated signup. Keyed hash of address so
 * it's stable and opaque.
 */
function provisionalHandle({
  email,
  handleSecret,
}: {
  email: string;
  handleSecret: string;
}): string {
  return `signup_${createHmac("sha256", handleSecret)
    .update(email)
    .digest("base64url")
    .slice(0, 32)}`;
}

/** The address the ceremony was started for, or a refusal. */
function requireEmail(context: string | null | undefined): string {
  const email = normalizeIdentifierValue(context ?? "");
  // Deliberately shallow. This is the shape check that keeps junk out of a
  // User row; whether the address RECEIVES mail is settled by the confirmation
  // that follows somebody in, not by a regular expression standing in front of
  // them (ADR-117 §6).
  // An empty string contains no "@" either, so it is refused by the same
  // clause rather than by one of its own.
  if (!email.includes("@") || email.length > 320) {
    throw new APIError("BAD_REQUEST", {
      code: PASSKEY_SIGNUP_EMAIL_INVALID,
      message: "Enter an email address to create an account.",
    });
  }
  return email;
}

async function refuseIfRegistered({
  users,
  email,
}: {
  users: PasskeySignUpDirectory;
  email: string;
}): Promise<void> {
  // Case-insensitive for the same reason `user.register` is: rows written
  // before addresses were stored lowercased may carry capitals, and a
  // case-twin beside one is two Users answering for one person.
  const existing = await users.findByEmail({ email });
  if (!existing) return;

  throw new APIError("BAD_REQUEST", {
    code: PASSKEY_SIGNUP_EMAIL_TAKEN,
    message: "That email already has an account. Log in with it instead.",
  });
}

/**
 * Resolves ceremony user (unauthenticated signup): address without account
 * and its handle. Name/displayName are credential manager display text.
 */
async function resolveUser({
  handleSecret,
  users,
  context,
}: {
  ctx: GenericEndpointContext;
  handleSecret: string;
  users: PasskeySignUpDirectory;
  context?: string | null | undefined;
}): Promise<{ id: string; name: string; displayName: string }> {
  const email = requireEmail(context);
  await refuseIfRegistered({ users, email });

  return {
    id: provisionalHandle({ email, handleSecret }),
    name: email,
    displayName: email,
  };
}

/**
 * After ceremony succeeds, create account and return userId. Session opened
 * by plugin in one atomic transaction (ceremony, write, mint).
 */
function createAfterVerification({
  announcements,
  users,
  verification,
}: {
  announcements: BetterAuthAnnouncements;
  users: PasskeySignUpDirectory;
  verification: SignUpVerification;
}) {
  return async function afterVerification({
    context,
  }: {
    ctx: GenericEndpointContext;
    context?: string | null | undefined;
  }): Promise<{ userId: string; name: string }> {
    const email = requireEmail(context);
    // Again, because the check in `resolveUser` was one network round trip ago
    // and an account can be created in that window. The unique index on the
    // address is the real backstop; this is the one that answers in words.
    await refuseIfRegistered({ users, email });

    const user = await users.createPasskeyUser({ email });
    announcements.trackServerEvent({ userId: user.id, event: "signed_up" });

    // Address confirmation sent here (not from screen to avoid races, ADR-117 §6).
    // Not awaited; if mailer is down, account is still made and recovery is in-app.
    void verification.requestVerification({ email }).catch((failure: unknown) => {
      logger.warn(
        { error: failure, userId: user.id },
        "passkey sign-up could not send the address confirmation",
      );
    });

    return {
      userId: user.id,
      // The stored label, where the browser did not supply one. The address is
      // what somebody scanning a list of passkeys recognises.
      name: email,
    };
  };
}

/**
 * The plugin's `registration` block. Exported whole so the flag that mounts
 * the plugin is the only thing deciding whether any of it exists.
 */
export function passkeySignUpRegistration(options: {
  announcements: BetterAuthAnnouncements;
  handleSecret: string;
  users: PasskeySignUpDirectory;
  verification: SignUpVerification;
}) {
  return {
    requireSession: false,
    resolveUser: ({ ctx, context }: { ctx: GenericEndpointContext; context?: string | null }) =>
      resolveUser({ ctx, context, users: options.users, handleSecret: options.handleSecret }),
    afterVerification: createAfterVerification(options),
  };
}
