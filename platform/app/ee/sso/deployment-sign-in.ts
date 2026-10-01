import { federatedProviderLabel } from "~/features/auth/logic/methodLabels";
import { legacyCallbackUrl } from "./providers";
import type { DeploymentSignIn } from "./sso-self-serve.types";

/**
 * The sign-in a deployment configures for itself (`NEXTAUTH_PROVIDER`), next
 * to the connection an organization sets up here.
 *
 * The two are separate doors with separate redirect addresses. A connection
 * returns to `/api/auth/sso/callback/<connection>`, which the setup page
 * shows. The deployment's provider returns to
 * `/api/auth/callback/<provider>`, and the sign-in page dials it whenever
 * the deployment names one, so an administrator who registered only one of
 * the two addresses sees the other one refused by their identity provider.
 */

/**
 * The deployment's own provider and the address it returns to, or null when
 * the deployment signs in with email and password only.
 */
export function deploymentSignInFor({
  provider,
  baseUrl,
}: {
  /** `NEXTAUTH_PROVIDER`, reported as `email` when the licence denies it. */
  provider: string | undefined;
  /** The deployment's own address. */
  baseUrl: string;
}): DeploymentSignIn | null {
  if (!provider || provider === "email") return null;
  return {
    name: federatedProviderLabel(provider),
    redirectUrl: legacyCallbackUrl({ baseUrl, providerId: provider }),
  };
}
