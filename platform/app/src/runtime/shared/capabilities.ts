export type Capability<T> = {
  readonly key: string;
  readonly __value?: T;
};

export function capability<T>(key: string): Capability<T> {
  if (!key.trim()) throw new Error("Capability keys cannot be empty.");
  return Object.freeze({ key });
}

type InstalledCapability = {
  provider: string;
  value: unknown;
};

export class CapabilityRegistry {
  private readonly installed = new Map<string, InstalledCapability>();
  private sealed = false;

  provide<T>(token: Capability<T>, value: T, provider: string): void {
    if (this.sealed) {
      throw new Error(
        `Capability registry is sealed; cannot provide "${token.key}".`,
      );
    }
    const existing = this.installed.get(token.key);
    if (existing) {
      throw new Error(
        `Capability "${token.key}" is provided by both "${existing.provider}" and "${provider}".`,
      );
    }
    this.installed.set(token.key, { provider, value });
  }

  require<T>(token: Capability<T>, consumer = "runtime"): T {
    const installed = this.installed.get(token.key);
    if (!installed) {
      throw new Error(
        `Feature "${consumer}" requires missing capability "${token.key}".`,
      );
    }
    return installed.value as T;
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
