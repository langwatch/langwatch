// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What counts as a Power Platform environment address.
 *
 * The Copilot Studio source authenticates by exchanging an application secret
 * for a token scoped to whatever environment its config names. That makes the
 * address field decide where the customer's secret is sent, so it is checked
 * when the source is saved rather than when it is pulled — by pull time the
 * admin who typed it is long gone and the only remaining signal is a run that
 * failed for reasons nobody can see.
 */

export const COPILOT_STUDIO_DATAVERSE_ADAPTER_ID =
  "copilot_studio_dataverse" as const;

/**
 * The registrable domains Microsoft serves Dataverse environments from, one
 * per cloud. Microsoft owns all four, so a customer cannot register a
 * lookalike inside them.
 *
 * Commercial and the US government community cloud both sit under
 * `dynamics.com`, differing only in the numbered `crm` label, so listing the
 * registrable domain rather than each `crm<N>` prefix keeps the check correct
 * when Microsoft adds another number — which it does.
 *
 * The cost of this list is real and was accepted: a customer whose
 * environment answers on their own domain cannot turn this source on
 * themselves and needs a support ticket. The alternative is posting their
 * application secret to any address that was typed into the form.
 *
 * Sources: Microsoft's Global Discovery Service cloud enum.
 * https://learn.microsoft.com/en-us/power-apps/developer/data-platform/sample-global-discovery-service-csharp
 * https://learn.microsoft.com/en-us/power-platform/admin/online-requirements
 */
const DATAVERSE_ENVIRONMENT_HOST_SUFFIXES = [
  ".dynamics.com", // commercial, and GCC via crm9
  ".microsoftdynamics.us", // US government (GCC High)
  ".appsplatform.us", // US Department of Defense
  ".dynamics.cn", // China, operated by 21Vianet
] as const;

/**
 * Whether a URL is the very environment the source is configured against.
 *
 * `isDataverseEnvironmentOrigin` answers a broader question — whether Microsoft
 * serves this host at all — and every tenant's environment passes it. That is
 * the right check for an address an admin typed, and the wrong one for a URL
 * the walk is about to send the token to: a link to another tenant's
 * environment is a Microsoft address, and forwarding the credential there is
 * still forwarding it to a stranger.
 */
export function isSameDataverseEnvironment(
  value: string,
  environmentUrl: string,
): boolean {
  if (!isDataverseEnvironmentOrigin(value)) return false;
  try {
    // `origin` normalises scheme, host case and default ports, so a link that
    // differs from the configured address only in those respects still counts
    // as the same environment.
    return new URL(value).origin === new URL(environmentUrl).origin;
  } catch {
    return false;
  }
}

export function isDataverseEnvironmentOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // Plain http would put the token on the wire in clear even for a real
  // environment, and credentials in the URL are never part of a legitimate one.
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  // `endsWith` on a leading-dot suffix, so `evildynamics.com` cannot pass as
  // `.dynamics.com` and the bare apex is not an environment either.
  return DATAVERSE_ENVIRONMENT_HOST_SUFFIXES.some((suffix) =>
    host.endsWith(suffix),
  );
}
