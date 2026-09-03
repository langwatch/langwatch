/**
 * The secret feature's application: what both of its doors call.
 *
 * It holds every service and port the feature needs, and it is the one typed
 * thing a transport is given. Before it, each door declared its own
 * `Readonly<{ secrets: SecretService }>` — two descriptions of the same bag,
 * agreeing by attention rather than by construction, and neither reachable
 * from the other.
 *
 * Most operations are the service's own, reached through {@link secrets}. What
 * lives here as a method is what a door would otherwise have to know: today
 * that is attributing a write to its caller, which both doors did for
 * themselves, twice each.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import type {
  CreateSecretInput,
  DeleteSecretInput,
  GetSecretInput,
  ListSecretsInput,
  Secret,
  SecretService,
  UpdateSecretInput,
} from "@langwatch/secret-contract";

/** Who a write is attributed to. */
export interface SecretCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface SecretAppDependencies {
  secrets: SecretService;
}

export class SecretApp {
  static create(dependencies: SecretAppDependencies): SecretApp {
    return new SecretApp(dependencies);
  }

  private constructor(private readonly dependencies: SecretAppDependencies) {}

  /** The project's secrets, metadata only. */
  list(input: ListSecretsInput): Promise<Secret[]> {
    return this.dependencies.secrets.list(input);
  }

  /** One secret's metadata. */
  get(input: GetSecretInput): Promise<Secret> {
    return this.dependencies.secrets.get(input);
  }

  /** Removes one secret from the project. */
  delete(input: DeleteSecretInput): Promise<void> {
    return this.dependencies.secrets.delete(input);
  }

  /**
   * Stores a new secret, attributed to the caller who asked for it.
   *
   * The attribution is here rather than in each door because a secret is a
   * live credential: "who added this" is a property of the act, not of the
   * transport it arrived over, and two doors stamping it separately is two
   * chances to stamp it differently or not at all.
   */
  create(input: Omit<CreateSecretInput, "actorId">, by: SecretCaller): Promise<Secret> {
    return this.dependencies.secrets.create({ ...input, actorId: by.id });
  }

  /** Replaces a secret's value, attributed to the caller who asked for it. */
  update(input: Omit<UpdateSecretInput, "actorId">, by: SecretCaller): Promise<Secret> {
    return this.dependencies.secrets.update({ ...input, actorId: by.id });
  }
}
