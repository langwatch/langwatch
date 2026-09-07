import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The deployment's one browser-session identity.
 *
 * `secret` and `url` are required TOGETHER: either alone composes a session
 * transport that rejects every sign-in while looking configured, which is why
 * the pair is a refinement and not a check at first request. Neither is
 * derived from the other, and neither is derived from the public base URL.
 *
 * `mfaEnrollmentOpen` and `passkeysEnabled` are read as the literal `on`,
 * which is the reading the platform application applied. Any other value is
 * refused rather than silently read as off, because a plugin mounted in one
 * process and not another is a route that exists for half the fleet.
 */
const onSwitch = z
  .union([z.literal("on"), z.literal("")])
  .optional()
  .transform((value) => value === "on");

export const authServerConfigDefinition = RuntimeConfig.define({
  sessionSecret: Config.value(z.string().optional(), { env: "NEXTAUTH_SECRET" }),
  sessionUrl: Config.value(z.string().optional(), { env: "NEXTAUTH_URL" }),
  mfaEnrollmentOpen: Config.value(onSwitch, { env: "MFA_ENROLLMENT_OPEN" }),
  passkeysEnabled: Config.value(onSwitch, { env: "PASSKEYS_ENABLED" }),
  /** Absent falls back to the session secret; a passkey handle must stay stable. */
  passkeyHandleSecret: Config.value(z.string().optional(), { env: "PASSKEY_HANDLE_SECRET" }),
});

export type AuthServerConfig = ConfigValue<typeof authServerConfigDefinition>;

export const authServerConfigSchema = compileRuntimeConfig(authServerConfigDefinition);

/**
 * Refuses a browser session that is half configured.
 *
 * Applied to the RESOLVED value rather than declared as a refinement on the
 * schema: the leaves transform as they parse, so the schema's output is not
 * its own input and a second parse of the result would refuse a value it had
 * just produced.
 */
export function assertAuthServerConfig(config: AuthServerConfig): void {
  const secret = config.sessionSecret?.trim();
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
