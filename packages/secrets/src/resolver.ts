/**
 * Scopes the chain per owner, preflights every required handle at start, and
 * seals when boot's last create returns. A value's whole life is inside
 * `into(handle, closure)` — only the constructed collaborator escapes.
 */
import type { SecretsChain } from "./chain.ts";
import type { SecretHandle } from "./secret.ts";

/** A resolve after boot finished: the capability is gone, on purpose. */
export class SealedSecretsError extends Error {
  constructor(id: string) {
    super(
      `The secret "${id}" was resolved after boot. Secrets resolve only while modules construct.`,
    );
    this.name = "SealedSecretsError";
  }
}

/** A create asked for a handle its owner never declared. */
export class UndeclaredSecretError extends Error {
  constructor(owner: string, id: string) {
    super(
      `"${owner}" resolved the secret "${id}" without declaring it. Declare the handle where the owner is defined.`,
    );
    this.name = "UndeclaredSecretError";
  }
}

/** A required secret no adapter answered, refused by its one id. */
export class AbsentSecretError extends Error {
  constructor(id: string) {
    super(`The secret "${id}" is not set. Set it, or mark the handle optional at its declaration.`);
    this.name = "AbsentSecretError";
  }
}

/** The preflight's verdict: every unanswerable required handle, at once. */
export class SecretsPreflightError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(
      `No adapter answers these required secrets:\n  ${missing.join("\n  ")}\n` +
        `Set each, or mark its handle optional at the declaration.`,
    );
    this.name = "SecretsPreflightError";
  }
}

export class SecretsResolver {
  static over(chain: SecretsChain): SecretsResolver {
    return new SecretsResolver(chain);
  }

  #sealed = false;

  private constructor(private readonly chain: SecretsChain) {}

  /** The capability one owner's create() receives: its own handles, nothing else. */
  scopeTo(owner: string, declared: readonly SecretHandle<unknown>[]): ScopedSecrets {
    const ids = new Set(declared.map((handle) => handle.id));

    return new ScopedSecrets(async (handle, build) => {
      if (this.#sealed) throw new SealedSecretsError(handle.id);

      if (!ids.has(handle.id)) throw new UndeclaredSecretError(owner, handle.id);

      const raw = await this.chain.fetch(handle.id);

      if (raw === undefined && !handle.optional) throw new AbsentSecretError(handle.id);

      const value = raw === undefined ? undefined : (handle.schema?.parse(raw) ?? raw);

      // The value's whole life: into the closure, and only the collaborator escapes.
      return build(value);
    });
  }

  seal(): void {
    this.#sealed = true;
  }

  /**
   * Fails the boot at second zero with the whole shopping list, instead of at
   * the Nth module's constructor. Answers are fetched to test and dropped.
   */
  async preflight(declared: readonly SecretHandle<unknown>[]): Promise<void> {
    const required = [...new Set(declared.filter((h) => !h.optional).map((h) => h.id))];
    const answers = await Promise.all(required.map((id) => this.chain.fetch(id)));
    const missing = required.filter((_, index) => answers[index] === undefined);

    if (missing.length > 0) throw new SecretsPreflightError(missing);
  }
}

type Into = <Value, Out>(
  handle: SecretHandle<Value>,
  build: (value: Value) => Out | Promise<Out>,
) => Promise<Out>;

/** There is no `get()` returning a string to keep — only `into`. */
export class ScopedSecrets {
  constructor(
    private readonly resolve: (
      handle: SecretHandle<unknown>,
      build: (value: unknown) => unknown,
    ) => Promise<unknown>,
  ) {}

  into: Into = async (handle, build) =>
    (await this.resolve(
      handle as SecretHandle<unknown>,
      build as (value: unknown) => unknown,
    )) as never;
}
