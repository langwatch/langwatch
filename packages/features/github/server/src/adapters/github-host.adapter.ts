import { GithubHostPort } from "../ports/github-host.port";

const GITHUB_DOT_COM = "github.com";

export type GithubHostConfig = {
  host?: string;
};

export class GithubHostAdapter extends GithubHostPort {
  static create(config: GithubHostConfig = {}): GithubHostAdapter {
    return new GithubHostAdapter(config);
  }

  private constructor(private readonly config: GithubHostConfig) {
    super();
  }

  getHost(): string {
    const configured = (this.config.host ?? "").trim().toLowerCase();
    return configured === "" ? GITHUB_DOT_COM : configured;
  }

  getApiBase(): string {
    const host = this.getHost();
    return host === GITHUB_DOT_COM ? "https://api.github.com" : `https://${host}/api/v3`;
  }

  getWebBase(): string {
    return `https://${this.getHost()}`;
  }

  getAppInstallUrl(appSlug: string): string {
    const host = this.getHost();
    const segment = host === GITHUB_DOT_COM ? "apps" : "github-apps";
    return `https://${host}/${segment}/${encodeURIComponent(appSlug)}/installations/new`;
  }

  isMappable(repositoryHost: string): boolean {
    return this.normalize(repositoryHost) === this.getHost();
  }

  normalize(repositoryHost: string): string {
    const host = repositoryHost.toLowerCase();
    return host === "" ? this.getHost() : host;
  }
}
