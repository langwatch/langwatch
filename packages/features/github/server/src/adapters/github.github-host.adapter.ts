/**
 * The GitHub host this instance is bound to, and everything derived from it.
 *
 * One instance connects to exactly one GitHub. `GITHUB_LANGY_HOST` names it;
 * unset means github.com, which is what every deployment gets unless an
 * operator sets it. GitHub Enterprise Server differs from github.com in more
 * than the hostname, so a caller cannot build these strings by substitution:
 * the REST API lives under `/api/v3` on the instance itself instead of on a
 * separate `api.` hostname, and an App's public page sits under `/github-apps/`
 * instead of `/apps/`. Both shapes are derived here so no call site has to
 * remember either one.
 *
 * Spec: specs/integrations/github-connection.feature.
 */
/** The public GitHub, and the host an instance that names none talks to. */
export const GITHUB_DOT_COM = "github.com";

export interface GithubHostConfig {
  host?: string;
}

/**
 * The host this instance talks to, lowercased. Hosts are case insensitive, and
 * this value is compared against hosts a session reported off its git remote,
 * which carry whatever casing the developer's remote had.
 */
export function getGithubHost(config: GithubHostConfig = {}): string {
  const configured = (config.host ?? "").trim().toLowerCase();
  return configured === "" ? GITHUB_DOT_COM : configured;
}

/** github.com answers on a separate hostname; Enterprise Server does not. */
export function getGithubApiBase(config: GithubHostConfig = {}): string {
  const host = getGithubHost(config);
  return host === GITHUB_DOT_COM ? "https://api.github.com" : `https://${host}/api/v3`;
}

/** The origin the account settings and uninstall pages are addressed from. */
export function getGithubWebBase(config: GithubHostConfig = {}): string {
  return `https://${getGithubHost(config)}`;
}

/**
 * The App's public installation page, where an install starts.
 *
 * github.com serves it under `/apps/`; an Enterprise Server instance serves the
 * Apps registered on it under `/github-apps/`.
 */
export function getGithubAppInstallUrl(
  appSlug: string,
  config: GithubHostConfig = {},
): string {
  const host = getGithubHost(config);
  const segment = host === GITHUB_DOT_COM ? "apps" : "github-apps";
  return `https://${host}/${segment}/${encodeURIComponent(appSlug)}/installations/new`;
}

/**
 * Whether this instance's connection can answer for a repository on this host.
 *
 * An unset host means the configured one, because a session that reported no
 * host is describing the only GitHub this instance knows about. Anything else
 * is a host we have no connection to, including github.com itself on an
 * instance bound to an Enterprise Server.
 *
 * Case-folded, because a session records whatever casing its git remote
 * carries. A literal comparison refuses `GitHub.com` outright, so that session
 * is never mapped at all, and every reader downstream folds its host and then
 * looks for a mapping row nothing ever wrote.
 */
export function isMappableGithubHost(
  repositoryHost: string,
  config: GithubHostConfig = {},
): boolean {
  return normalizeGithubHost(repositoryHost, config) === getGithubHost(config);
}

/** The host to store: the configured one, spelled out and folded, so rows compare. */
export function normalizeGithubHost(
  repositoryHost: string,
  config: GithubHostConfig = {},
): string {
  const host = repositoryHost.toLowerCase();
  return host === "" ? getGithubHost(config) : host;
}
