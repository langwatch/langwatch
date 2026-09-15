import { randomBytes } from "node:crypto";
import { DEV_GENERATED_KEYS } from "./keys.ts";
import { referenceFor, writeFields, type VaultItem } from "./one-password-item.ts";
import type { ProcessRunner } from "./process-runner.port.ts";
import { SecretSource } from "./secret-source.port.ts";

/** The cadence `.env.example` and the two ensure scripts already document. */
function generateOne(): string {
  return randomBytes(32).toString("hex");
}

// On first launch with vault: mints the four generate-marked values to 1Password
// instead of .env, leaving no credential on disk. Other lookups fall through to refusal.
export class DevGeneratedSecretSource extends SecretSource {
  static create({
    item,
    runner,
    name = "generated",
  }: {
    item: VaultItem;
    runner: ProcessRunner;
    name?: string;
  }): DevGeneratedSecretSource {
    return new DevGeneratedSecretSource(item, runner, name);
  }

  private constructor(
    private readonly item: VaultItem,
    private readonly runner: ProcessRunner,
    readonly name: string,
  ) {
    super();
  }

  /** Where a generated value now lives, for the line that reports the write. */
  referenceFor(key: string): string {
    return referenceFor({ item: this.item, key });
  }

  async resolve({ keys }: { keys: readonly string[] }): Promise<Map<string, string>> {
    const generated = new Map<string, string>();
    for (const key of keys) {
      if (DEV_GENERATED_KEYS.includes(key)) generated.set(key, generateOne());
    }
    if (generated.size === 0) return generated;

    await writeFields({ fields: generated, item: this.item, runner: this.runner });

    return generated;
  }
}
