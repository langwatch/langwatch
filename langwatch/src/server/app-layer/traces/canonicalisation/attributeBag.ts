import type { NormalizedAttributes } from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";

export class AttributeBag {
  private readonly map: Map<string, unknown>;

  constructor(input: NormalizedAttributes) {
    this.map = new Map(Object.entries(input));
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): unknown {
    return this.map.get(key);
  }

  /**
   * @deprecated Values are now pre-parsed during normalization.
   * Use `get()` instead — it returns the already-parsed value.
   */
  getParsed(key: string, _maxSafeSize?: number): unknown {
    return this.map.get(key);
  }

  take(key: string): unknown {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
    }
    return v;
  }

  /**
   * @deprecated Use `take()` instead — values are already parsed.
   */
  takeParsed(key: string): unknown {
    return this.take(key);
  }

  takeAny(
    keys: readonly string[],
  ): { key: string; value: unknown } | null {
    for (const k of keys) {
      const v = this.take(k);
      if (v !== undefined) return { key: k, value: v };
    }
    return null;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  remaining(): NormalizedAttributes {
    return Object.fromEntries(this.map.entries());
  }
}
