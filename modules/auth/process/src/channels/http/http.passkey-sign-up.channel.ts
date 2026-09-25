import { createHmac } from "node:crypto";

import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { UserApi } from "@langwatch/user-contract";
import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { z } from "zod";

import type { BetterAuthAnnouncements } from "../better-auth.channel.ts";

/** Everything the passkey ceremony asks of the user directory. */
export type PasskeySignUpDirectory = Pick<UserApi, "findByEmail" | "createPasskeyUser">;

/** The mailbox proof a spent confirmation link minted: checked before the ceremony,
 *  spent after it. */
export interface SignUpVerification {
  validateAddressProof(input: { token: string; email: string }): Promise<boolean>;
  claimAddressProof(input: { token: string; email: string }): Promise<boolean>;
}

const logger = createLogger("langwatch:better-auth:passkey-signup");

/**
 * The code the sign-up screen watches for, so an already-registered address
 * turns the screen into log-in rather than reporting a failed ceremony —
 * refused BEFORE the ceremony, so no system prompt ever opens for it.
 */
export const PASSKEY_SIGNUP_EMAIL_TAKEN = "EMAIL_ALREADY_REGISTERED";

/** The code for an address the endpoint will not accept at all. */
export const PASSKEY_SIGNUP_EMAIL_INVALID = "INVALID_EMAIL";

/** The code for a ceremony whose address proof is missing, spent, expired or another address's. */
export const PASSKEY_SIGNUP_VERIFICATION_REQUIRED = "VERIFICATION_REQUIRED";

/** What the sign-up screen bakes into the registration challenge. */
const signUpContextSchema = z.object({
  email: z.string(),
  addressProof: z.string().min(1),
});

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

function parseContext(context: string | null | undefined): unknown {
  try {
    return JSON.parse(context ?? "");
  } catch {
    return null;
  }
}

/** The address the ceremony was started for and the proof it carries, or a refusal. */
function resolveSignUpContext(context: string | null | undefined): {
  email: string;
  addressProof: string;
} {
  const carried = signUpContextSchema.safeParse(parseContext(context));
  const resolvedEmail = carried.success ? normalizeIdentifierValue(carried.data.email) : "";
  // Deliberately shallow: whether the address RECEIVES mail was settled by the
  // link that minted the proof, not by a regex (ADR-117 §6).
  if (!resolvedEmail.includes("@") || resolvedEmail.length > 320) {
    throw new APIError("BAD_REQUEST", {
      code: PASSKEY_SIGNUP_EMAIL_INVALID,
      message: "Enter an email address to create an account.",
    });
  }
  if (!carried.success) {
    throw new APIError("BAD_REQUEST", {
      code: PASSKEY_SIGNUP_EMAIL_INVALID,
      message: "Restart passkey sign-up from this browser.",
    });
  }
  return { email: resolvedEmail, addressProof: carried.data.addressProof };
}

function verificationRequired(): APIError {
  return new APIError("FORBIDDEN", {
    code: PASSKEY_SIGNUP_VERIFICATION_REQUIRED,
    message: "Verify this email address before creating a passkey.",
  });
}

async function refuseIfRegistered({
  users,
  email: candidateEmail,
}: {
  users: PasskeySignUpDirectory;
  email: string;
}): Promise<void> {
  // Case-insensitive for the same reason `user.register` is: rows written
  // before addresses were stored lowercased may carry capitals, and a
  // case-twin beside one is two Users answering for one person.
  const existing = await users.findByEmail({ email: candidateEmail });
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
  verification,
  context,
}: {
  ctx: GenericEndpointContext;
  handleSecret: string;
  users: PasskeySignUpDirectory;
  verification: SignUpVerification;
  context?: string | null | undefined;
}): Promise<{ id: string; name: string; displayName: string }> {
  const { email: resolvedEmail, addressProof } = resolveSignUpContext(context);
  if (!(await verification.validateAddressProof({ token: addressProof, email: resolvedEmail }))) {
    throw verificationRequired();
  }
  await refuseIfRegistered({ users, email: resolvedEmail });

  return {
    id: provisionalHandle({ email: resolvedEmail, handleSecret }),
    name: resolvedEmail,
    displayName: resolvedEmail,
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
}): (params: {
  ctx: GenericEndpointContext;
  context?: string | null | undefined;
}) => Promise<{ userId: string; name: string }> {
  return async function afterVerification({
    context,
  }: {
    ctx: GenericEndpointContext;
    context?: string | null | undefined;
  }): Promise<{ userId: string; name: string }> {
    const { email: resolvedEmail, addressProof } = resolveSignUpContext(context);
    // Again, because the check in `resolveUser` was one network round trip ago
    // and an account can be created in that window. The unique index on the
    // address is the real backstop; this is the one that answers in words.
    await refuseIfRegistered({ users, email: resolvedEmail });

    // Spent before anything is written: the proof is the authority to enrol.
    if (!(await verification.claimAddressProof({ token: addressProof, email: resolvedEmail }))) {
      logger.info("a passkey sign-up finished without a live address proof; nothing was created");
      throw verificationRequired();
    }

    const user = await users.createPasskeyUser({ email: resolvedEmail });
    announcements.trackServerEvent({ userId: user.id, event: "signed_up" });

    return {
      userId: user.id,
      // The stored label, where the browser did not supply one. The address is
      // what somebody scanning a list of passkeys recognises.
      name: resolvedEmail,
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
}): {
  requireSession: boolean;
  resolveUser: (params: {
    ctx: GenericEndpointContext;
    context?: string | null;
  }) => Promise<{ id: string; name: string; displayName: string }>;
  afterVerification: (params: {
    ctx: GenericEndpointContext;
    context?: string | null | undefined;
  }) => Promise<{ userId: string; name: string }>;
} {
  return {
    requireSession: false,
    resolveUser: ({ ctx, context }: { ctx: GenericEndpointContext; context?: string | null }) =>
      resolveUser({
        ctx,
        context,
        users: options.users,
        verification: options.verification,
        handleSecret: options.handleSecret,
      }),
    afterVerification: createAfterVerification(options),
  };
}
