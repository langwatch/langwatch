import type {
  SigningKeyHourlyUsage,
  SigningKeyUsageRepository,
} from "../signing-key-usage.repository.ts";

/** Hourly signature counts in one process; nothing expires, which a test never notices. */
export class MemorySigningKeyUsageRepository implements SigningKeyUsageRepository {
  readonly #counts = new Map<string, { passed: number; failed: number }>();

  static create(): MemorySigningKeyUsageRepository {
    return new MemorySigningKeyUsageRepository();
  }

  private constructor() {}

  async add({ usage }: { usage: readonly SigningKeyHourlyUsage[] }): Promise<void> {
    for (const entry of usage) {
      const key = `${entry.keyId}:${entry.hour}`;
      const held = this.#counts.get(key) ?? { passed: 0, failed: 0 };
      this.#counts.set(key, {
        passed: held.passed + entry.passed,
        failed: held.failed + entry.failed,
      });
    }
  }

  async findTotals({
    keyIds,
    fromHour,
    toHour,
  }: {
    keyIds: readonly string[];
    fromHour: number;
    toHour: number;
  }): Promise<{ keyId: string; passed: number; failed: number }[]> {
    return keyIds.map((keyId) => {
      const total = { keyId, passed: 0, failed: 0 };
      for (let hour = fromHour; hour <= toHour; hour++) {
        const held = this.#counts.get(`${keyId}:${hour}`);
        total.passed += held?.passed ?? 0;
        total.failed += held?.failed ?? 0;
      }
      return total;
    });
  }
}
