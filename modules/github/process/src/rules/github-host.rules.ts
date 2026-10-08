const GITHUB_DOT_COM = "github.com";

type GithubHostConfig = {
  host?: string;
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

export function hostNameOf({ configured }: { configured?: string }): string {
  const host = (configured ?? "").trim().toLowerCase();
  return host === "" ? GITHUB_DOT_COM : host;
}

export function apiBaseOf({ host }: { host: string }): string {
  return host === GITHUB_DOT_COM ? "https://api.github.com" : `https://${host}/api/v3`;
}

export function webBaseOf({ host }: { host: string }): string {
  return `https://${host}`;
}

export function appInstallUrlOf({ host, appSlug }: { host: string; appSlug: string }): string {
  const segment = host === GITHUB_DOT_COM ? "apps" : "github-apps";
  return `https://${host}/${segment}/${encodeURIComponent(appSlug)}/installations/new`;
}

export function normalizeRepositoryHost({
  host,
  repositoryHost,
}: {
  host: string;
  repositoryHost: string;
}): string {
  const lowered = repositoryHost.toLowerCase();
  return lowered === "" ? host : lowered;
}

export function isMappableRepositoryHost({
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
  return {
    getHost: () => host,
    getApiBase: () => apiBaseOf({ host }),
    getWebBase: () => webBaseOf({ host }),
    getAppInstallUrl: (appSlug) => appInstallUrlOf({ host, appSlug }),
    isMappable: (repositoryHost) => isMappableRepositoryHost({ host, repositoryHost }),
    normalize: (repositoryHost) => normalizeRepositoryHost({ host, repositoryHost }),
  };
}
