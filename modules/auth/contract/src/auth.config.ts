import {
  Config,
  idpSimulatorUrl,
  isSaas,
  localPasswords,
  mfaEnrollmentOpen,
  nodeEnvironment,
  passkeysEnabled,
  positiveSafeIntegerOrUndefined,
  publicBaseUrl,
  signInProviders,
  signUpMode,
  trustedIdpOrigins,
  type ConfigOf,
} from "@langwatch/config";
import { defineBrowserConfig } from "@langwatch/config/public-app-config";
import { z } from "zod";

export const authServerConfig = Config.define((c) => ({
  sessionUrl: c.env("NEXTAUTH_URL", z.string().optional()),
  /** The shared capability switches identity and user read too (round 48, A1-a). */
  mfaEnrollmentOpen,
  passkeysEnabled,
  /** Absent falls back to the session secret; a passkey handle must stay stable. */
  passkeyHandleSecret: c.env("PASSKEY_HANDLE_SECRET", z.string().optional()),
  /** The operator's trusted identity providers, and the worktree simulator outside production. */
  trustedIdpOrigins,
  idpSimulatorUrl,
  /** D09: this deployment issues its own passwords beside a federated provider. */
  localPasswords,
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
  /**
   * How long an idle CLI refresh token lives, in seconds. Unset or unreadable keeps the
   * service's default quarter, as main did; shorten it so a stolen CLI config goes stale sooner.
   */
  cliRefreshTokenTtlSeconds: c.env(
    "LANGWATCH_CLI_REFRESH_TOKEN_TTL_SECONDS",
    z.string().optional().transform(positiveSafeIntegerOrUndefined),
  ),
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
  /** Provider ids the Connect buttons offer: the named one, then each social one set up. */
  federatedProviders: z.array(z.string().min(1)),
  /**
   * `invite_only` hides the create-account links. The server refuses an uninvited sign-up
   * either way; this only stops offering a door most visitors cannot use.
   */
  signUpMode: z.enum(["open", "invite_only"]),
});

export type AuthWebConfig = z.infer<typeof authWebConfigSchema>;

/** Rail order; Microsoft keeps its legacy callback id, as the sign-in rail does. */
function federatedProvidersOf({
  authProvider,
  providers,
}: {
  authProvider: string | undefined;
  providers: AuthServerConfig["signInProviders"];
}): string[] {
  if (!authProvider || authProvider === "email") return [];
  const social = [
    providers.googleClientId && "google",
    providers.githubClientId && "github",
    providers.gitlabClientId && "gitlab",
    providers.azureAdClientId && providers.azureAdTenantId && "azure-ad",
  ].filter((id): id is string => !!id);
  return Array.from(new Set([authProvider, ...social]));
}

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
      federatedProviders: federatedProvidersOf({
        authProvider,
        providers: config.signInProviders,
      }),
      signUpMode: config.signUpMode,
      ...(authProvider ? { authProvider } : {}),
      ...(publicUrl ? { publicUrl } : {}),
    };
  },
});
