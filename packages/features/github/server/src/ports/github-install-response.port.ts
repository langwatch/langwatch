export abstract class GithubInstallResponsePort {
  abstract successHtml(login: string): string;
  abstract errorHtml(message: string): string;
}
