/**
 * This deployment's sign-in mode (ADR-027): the configured provider only when
 * licensed and mounted, otherwise email mode (main's `resolveAuthProvider`).
 */
export class AuthProviderService {
  static create(deps: {
    configuredProvider: string;
    providerMounted: boolean;
    platformSsoAllowed: () => Promise<boolean>;
  }): AuthProviderService {
    return new AuthProviderService(deps);
  }

  private constructor(
    private readonly deps: {
      configuredProvider: string;
      providerMounted: boolean;
      platformSsoAllowed: () => Promise<boolean>;
    },
  ) {}

  async resolve(): Promise<string> {
    const provider = this.deps.configuredProvider;
    if (provider === "email") return "email";
    if (!(await this.deps.platformSsoAllowed())) return "email";
    return this.deps.providerMounted ? provider : "email";
  }
}
