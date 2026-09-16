import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Browser-session identity. Secret and URL are a refinement (both or neither);
 * mfaEnrollmentOpen and passkeysEnabled are literal "on", other values refused.
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
 * Refuses a browser session that is half configured. Applied to the RESOLVED
 * value, not a schema refinement: the leaves transform as they parse, so a
 * second parse of the output would refuse a value it just produced.
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
