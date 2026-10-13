import { AsyncLocalStorage } from "node:async_hooks";

type ProfileMapper = (profile: Record<string, unknown>) => unknown;

/**
 * The address an OAuth provider's profile carried on this request, kept so a refused account
 * link's redirect can name the connection that governs it
 * (specs/auth/sso-wrong-provider-recovery.feature).
 */
export class OAuthProfileEmailChannel {
  static create(): OAuthProfileEmailChannel {
    return new OAuthProfileEmailChannel();
  }

  private readonly scope = new AsyncLocalStorage<{ email: string | undefined }>();

  private constructor() {}

  /** Opens the per-request slot the profile mapping writes into. */
  runWithScope<T>(run: () => Promise<T>): Promise<T> {
    return this.scope.run({ email: undefined }, run);
  }

  /** Keeps the address one mapped profile carried; ignored outside a request. */
  note({ email }: { email: unknown }): void {
    const slot = this.scope.getStore();
    if (slot && typeof email === "string" && email.length > 0) slot.email = email;
  }

  /** The address this request's provider profile carried, when one was mapped. */
  findEmail(): string | undefined {
    return this.scope.getStore()?.email;
  }

  /** One provider's configuration, its profile mapping wrapped to note the address it maps. */
  capturing<C extends object>(
    config: C,
  ): C & { mapProfileToUser: (profile: Record<string, unknown>) => Promise<unknown> } {
    const mapsProfile: { mapProfileToUser?: ProfileMapper } = config;
    const original = mapsProfile.mapProfileToUser;
    const mapProfileToUser = async (profile: Record<string, unknown>) => {
      const mapped = (await original?.(profile)) ?? {};
      this.note({ email: emailOf(mapped) ?? emailOf(profile) });
      return mapped;
    };
    return { ...config, mapProfileToUser };
  }
}

function emailOf(value: unknown): unknown {
  return typeof value === "object" && value !== null && "email" in value ? value.email : undefined;
}
