export abstract class GithubHostPort {
  abstract getHost(): string;
  abstract getApiBase(): string;
  abstract getWebBase(): string;
  abstract getAppInstallUrl(appSlug: string): string;
  abstract isMappable(repositoryHost: string): boolean;
  abstract normalize(repositoryHost: string): string;
}
