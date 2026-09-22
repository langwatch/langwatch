import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Browser-session identity. Secret and URL are a refinement (both or neither);
 * mfaEnrollmentOpen and passkeysEnabled are literal "on", other values refused.
 */
const onSwitch = z
  .union([z.literal("on"), z.literal("")])
  .optional()
  .transform((value) => value === "on");

export const authServerConfig = Config.define((c) => ({
  sessionUrl: c.env("NEXTAUTH_URL", z.string().optional()),
  mfaEnrollmentOpen: c.env("MFA_ENROLLMENT_OPEN", onSwitch),
  passkeysEnabled: c.env("PASSKEYS_ENABLED", onSwitch),
  /** Absent falls back to the session secret; a passkey handle must stay stable. */
  passkeyHandleSecret: c.env("PASSKEY_HANDLE_SECRET", z.string().optional()),
  /**
   * Identity providers this operator trusts outright, beyond the ones their
   * customers registered: commas or spaces, and the way on for a provider
   * inside a private network. Honoured in production too.
   */
  trustedIdpOrigins: c.env("SSO_TRUSTED_IDP_ORIGINS", z.string().optional()),
  /**
   * The identity-provider simulator a development worktree runs, trusted
   * outside production ONLY — it signs whatever it is asked to sign.
   */
  idpSimulatorUrl: c.env("LANGWATCH_IDPSIM_URL", z.string().optional()),
}));

export type AuthServerConfig = ConfigOf<typeof authServerConfig>;

/**
 * Refuses a browser session that is half configured. `sessionSecret` now
 * arrives resolved through the secrets member (ADR-132), never this config
 * object, so the caller passes it in alongside the resolved value.
 */
export function assertAuthServerConfig(
  config: AuthServerConfig,
  sessionSecret: string | undefined,
): void {
  const secret = sessionSecret?.trim();
  const url = config.sessionUrl?.trim();
  if (Boolean(secret) === Boolean(url)) return;

  throw new Error(
    "Sign-in needs both a session secret and a session URL (NEXTAUTH_SECRET and NEXTAUTH_URL). " +
      "Set the missing one, or remove both to run without browser sign-in.",
  );
}

/**
 * What a browser is told about sign-in: whether there is an endpoint behind
 * the passkey button, and whether the identifier-first screens are the front
 * door here. Both derived, never the raw setting.
 */
export const authWebConfigSchema = z.strictObject({
  passkeys: z.boolean(),
  identityFrontDoor: z.boolean(),
});

export type AuthWebConfig = z.infer<typeof authWebConfigSchema>;
