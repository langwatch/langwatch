const GITHUB_DOT_COM = "github.com";

/** `apiBase` and `webBase` name the origins outright (a stand-in); absent, the host decides. */
export type GithubHostConfig = {
  host?: string;
  apiBase?: string;
  webBase?: string;
};

/** The host arithmetic one deployment's configured GitHub host answers. */
export type GithubHost = {
  getHost(): string;
  getApiBase(): string;
  getWebBase(): string;
  getAppInstallUrl(appSlug: string): string;
  isMappable(repositoryHost: string): boolean;
  normalize(repositoryHost: string): string;
};

function hostNameOf({ configured }: { configured?: string }): string {
  const host = (configured ?? "").trim().toLowerCase();
  return host === "" ? GITHUB_DOT_COM : host;
}

/** The named origin without trailing slashes; empty when none was named. */
function cleanBase({ base }: { base: string | undefined }): string {
  return (base ?? "").trim().replace(/\/+$/, "");
}

function apiBaseOf({ host }: { host: string }): string {
  return host === GITHUB_DOT_COM ? "https://api.github.com" : `https://${host}/api/v3`;
}

function webBaseOf({ host }: { host: string }): string {
  return `https://${host}`;
}

function appInstallUrlOf({
  host,
  webBase,
  appSlug,
}: {
  host: string;
  webBase: string;
  appSlug: string;
}): string {
  const segment = host === GITHUB_DOT_COM ? "apps" : "github-apps";
  return `${webBase}/${segment}/${encodeURIComponent(appSlug)}/installations/new`;
}

function normalizeRepositoryHost({
  host,
  repositoryHost,
}: {
  host: string;
  repositoryHost: string;
}): string {
  const lowered = repositoryHost.toLowerCase();
  return lowered === "" ? host : lowered;
}

function isMappableRepositoryHost({
  host,
  repositoryHost,
}: {
  host: string;
  repositoryHost: string;
}): boolean {
  return normalizeRepositoryHost({ host, repositoryHost }) === host;
}

/** The configured host's arithmetic, bound once so callers keep asking one object. */
export function githubHostOf(config: GithubHostConfig = {}): GithubHost {
  const host = hostNameOf({ configured: config.host });
  const apiBase = cleanBase({ base: config.apiBase }) || apiBaseOf({ host });
  const webBase = cleanBase({ base: config.webBase }) || webBaseOf({ host });
  return {
    getHost: () => host,
    getApiBase: () => apiBase,
    getWebBase: () => webBase,
    getAppInstallUrl: (appSlug) => appInstallUrlOf({ host, webBase, appSlug }),
    isMappable: (repositoryHost) => isMappableRepositoryHost({ host, repositoryHost }),
    normalize: (repositoryHost) => normalizeRepositoryHost({ host, repositoryHost }),
  };
}
