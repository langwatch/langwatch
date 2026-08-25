/**
 * A typed, process-local key for one runtime capability.
 *
 * The phantom field makes the value type part of the token's TypeScript type
 * without adding data to the runtime object.
 */
export class Capability<Value> {
  declare private readonly valueType: Value;

  static create<Value>(key: string): Capability<Value> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error("Capability keys cannot be empty.");
    }
    return new Capability<Value>(normalizedKey);
  }

  private constructor(readonly key: string) {
    Object.freeze(this);
  }
}

type InstalledCapability = {
  provider: string;
  value: unknown;
};

/**
 * The mutable build-time capability registry. A completed runtime exposes the
 * same instance in its sealed state, so late registration fails rather than
 * silently changing the process graph.
 */
export class CapabilityRegistry {
  static create(): CapabilityRegistry {
    return new CapabilityRegistry();
  }

  private readonly installed = new Map<string, InstalledCapability>();
  private sealed = false;

  private constructor() {}

  provide<Value>(token: Capability<Value>, value: Value, provider: string): void {
    if (this.sealed) {
      throw new Error(`Capability registry is sealed; cannot provide "${token.key}".`);
    }
    const existing = this.installed.get(token.key);
    if (existing) {
      throw new Error(
        `Capability "${token.key}" is provided by both "${existing.provider}" and "${provider}".`,
      );
    }
    this.installed.set(token.key, { provider, value });
  }

  require<Value>(token: Capability<Value>, consumer = "runtime"): Value {
    const installed = this.installed.get(token.key);
    if (!installed) {
      throw new Error(
        `Feature "${consumer}" requires missing capability "${token.key}".`,
      );
    }
    return installed.value as Value;
  }

  has(token: Capability<unknown>): boolean {
    return this.installed.has(token.key);
  }

  seal(): void {
    this.sealed = true;
  }

  isSealed(): boolean {
    return this.sealed;
  }
}
