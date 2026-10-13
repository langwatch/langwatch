/**
 * The platform's own deep links, built from `publicBaseUrl` config: the same
 * pattern as `agent-platform-url.rules.ts`. An absent origin builds a relative
 * link, as main's `platformUrl` did over an unset `BASE_HOST`.
 */

function originOf(publicBaseUrl: string | undefined): string {
  return (publicBaseUrl ?? "").replace(/\/+$/, "");
}

function withLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** `${publicBaseUrl}/${projectSlug}${path}`: a page inside one project. */
export function langyProjectPlatformUrl(input: {
  publicBaseUrl: string | undefined;
  projectSlug: string;
  path: string;
}): string {
  return `${originOf(input.publicBaseUrl)}/${input.projectSlug}${withLeadingSlash(input.path)}`;
}

/** `${publicBaseUrl}${path}`: an organization page, beside the project pages. */
export function langyOrganizationPlatformUrl(input: {
  publicBaseUrl: string | undefined;
  path: string;
}): string {
  return `${originOf(input.publicBaseUrl)}${withLeadingSlash(input.path)}`;
}
