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
 *
 * The Web API version and the read headers live here too, beside the address
 * they are sent to. More than one module now reads a Dataverse collection —
 * the transcript walk and the agent list — and a second copy of either is a
 * copy that can drift out of agreement with the query shape it belongs to.
 */

export const COPILOT_STUDIO_DATAVERSE_ADAPTER_ID = "copilot_studio_dataverse";

/** Web API version every read in this family is written against. */
export const DATAVERSE_API_VERSION = "v9.2";

/** The headers every read of an environment carries. */
export function dataverseHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
  };
}

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
 * Whether a URL names the configured Dataverse base: the same origin, and for an
 * environment address the same path, with no credentials, query or fragment.
 */
function isConfiguredBase(params: {
  url: URL;
  configuredBase: string | undefined;
  isOriginOnly: boolean;
}): boolean {
  const { url, configuredBase, isOriginOnly } = params;
  if (!configuredBase) return false;
  let base: URL;
  try {
    base = new URL(configuredBase);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.origin !== base.origin) return false;
  if (isOriginOnly) return true;
  const bare = (path: string) => path.replace(/\/+$/, "");
  return bare(url.pathname) === bare(base.pathname) && url.search === "" && url.hash === "";
}

/**
 * Whether a URL is the very environment the source is configured against.
 *
 * `isEnvironmentOrigin` answers a broader question — whether Microsoft
 * serves this host at all — and every tenant's environment passes it. That is
 * the right check for an address an admin typed, and the wrong one for a URL
 * the walk is about to send the token to: a link to another tenant's
 * environment is a Microsoft address, and forwarding the credential there is
 * still forwarding it to a stranger. The configured base is the one other
 * origin a link may lead to, and only from a source configured against it.
 */
export function isSameEnvironment(params: {
  value: string;
  environmentUrl: string;
  configuredBase?: string;
}): boolean {
  const { value, environmentUrl, configuredBase } = params;

  try {
    const link = new URL(value);
    const environment = new URL(environmentUrl);
    if (
      isConfiguredBase({ url: link, configuredBase, isOriginOnly: true }) &&
      isConfiguredBase({ url: environment, configuredBase, isOriginOnly: true })
    ) {
      return true;
    }
    if (!isEnvironmentOrigin(value)) {
      return false;
    }
    // `origin` normalises scheme, host case and default ports, so a link that
    // differs from the configured address only in those respects still counts
    // as the same environment.
    return link.origin === environment.origin;
  } catch {
    return false;
  }
}

/** `configuredBase` is the one extra address an environment may be (a dev stand-in). */
export function isEnvironmentOrigin(value: string, configuredBase?: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (isConfiguredBase({ url, configuredBase, isOriginOnly: false })) {
    return true;
  }

  // Plain http would put the token on the wire in clear even for a real
  // environment, and credentials in the URL are never part of a legitimate one.
  if (url.protocol !== "https:") {
    return false;
  }

  if (url.username !== "" || url.password !== "") {
    return false;
  }

  const host = url.hostname.toLowerCase();

  // `endsWith` on a leading-dot suffix, so `evildynamics.com` cannot pass as
  // `.dynamics.com` and the bare apex is not an environment either.
  return DATAVERSE_ENVIRONMENT_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
