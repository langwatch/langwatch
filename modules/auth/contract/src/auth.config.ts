import {
  Config,
  isSaas,
  nodeEnvironment,
  publicBaseUrl,
  signInProviders,
  signUpMode,
  type ConfigOf,
} from "@langwatch/config";
import { defineBrowserConfig } from "@langwatch/config/public-app-config";
import { SignInMethodPolicyService } from "@langwatch/identity-contract";
import { z } from "zod";

/**
 * Browser-session identity. Secret and URL are a refinement (both or neither);
 * mfaEnrollmentOpen is literal "on"; passkeys are offered unless "off"; other values refused.
 */
const onSwitch = z
  .union([z.literal("on"), z.literal("")])
  .optional()
  .transform((value) => value === "on");

/** Passkeys are offered on every deployment an operator has not turned them off on. */
const passkeySwitch = z
  .enum(["off", "on"])
  .optional()
  .transform((value) => SignInMethodPolicyService.deploymentOffersPasskeys(value));

/** An explicit on/off switch, off when unset. */
const onOffSwitch = z
  .enum(["off", "on"])
  .optional()
  .transform((value) => value === "on");

export const authServerConfig = Config.define((c) => ({
  sessionUrl: c.env("NEXTAUTH_URL", z.string().optional()),
  mfaEnrollmentOpen: c.env("MFA_ENROLLMENT_OPEN", onSwitch),
  passkeysEnabled: c.env("PASSKEYS_ENABLED", passkeySwitch),
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
  /** D09: this deployment issues its own passwords beside a federated provider. */
  localPasswords: c.env("LOCAL_PASSWORDS_ENABLED", onOffSwitch),
  /**
   * The Auth0 Machine-to-Machine app a password change goes through; absent,
   * the login app's `AUTH0_CLIENT_ID` stands in, as main's did.
   */
  auth0ManagementClientId: c.env("AUTH0_MGMT_CLIENT_ID", z.string().min(1).optional()),
  /** The shared leaves sso reads too: which provider is named and its public half. */
  signInProviders,
  /** The process's own leaf, read here only to tell the browser whether passwords are on. */
  isSaas,
  /** Organization decides who may sign up; read here only to tell the browser the mode. */
  signUpMode,
  /** Process facts (§3.3): where links point, and what is trusted outside production only. */
  publicBaseUrl,
  nodeEnvironment,
}));

/**
 * Whether BetterAuth's email/password (credentials) routes are MOUNTED.
 * (ADR-027). Mounting is not the gate: the channel's `before` hook is.
 */
export const isEmailPasswordEnabled = (deployment: {
  authProvider: string | undefined;
  isSaas: boolean;
  localPasswords: boolean;
}): boolean =>
  deployment.authProvider === "email" || !deployment.isSaas || deployment.localPasswords;

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
  /** `AUTH_PROVIDER` (or its NextAuth-era name): a provider id, never a credential. */
  authProvider: z.string().min(1).optional(),
  /** `NEXTAUTH_URL`: the address readers reach this installation on, for copy-paste snippets. */
  publicUrl: z.string().min(1).optional(),
  /** Whether the email/password routes mount here, so the password section shows. */
  emailPasswordEnabled: z.boolean(),
  /**
   * `invite_only` hides the create-account links. The server refuses an uninvited sign-up
   * either way; this only stops offering a door most visitors cannot use.
   */
  signUpMode: z.enum(["open", "invite_only"]),
});

export type AuthWebConfig = z.infer<typeof authWebConfigSchema>;

/** The identifier-first screens are the only sign-in front door (ADR-117, bake end). */
export const authBrowserConfig = defineBrowserConfig({
  schema: authWebConfigSchema,
  project: (config: AuthServerConfig) => {
    const authProvider =
      config.signInProviders.authProvider ?? config.signInProviders.legacyProvider;
    const publicUrl = config.sessionUrl?.trim();
    return {
      passkeys: config.passkeysEnabled,
      identityFrontDoor: true,
      emailPasswordEnabled: isEmailPasswordEnabled({
        authProvider: authProvider ?? "email",
        isSaas: config.isSaas,
        localPasswords: config.localPasswords,
      }),
      signUpMode: config.signUpMode,
      ...(authProvider ? { authProvider } : {}),
      ...(publicUrl ? { publicUrl } : {}),
    };
  },
});
