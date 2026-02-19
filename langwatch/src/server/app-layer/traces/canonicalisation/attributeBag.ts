import type {
  NormalizedAttributes,
  NormalizedAttrValue,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";

export class AttributeBag {
  private readonly map: Map<string, NormalizedAttrValue>;
  private readonly parsedCache = new Map<string, unknown>();

  constructor(input: NormalizedAttributes) {
    this.map = new Map(
      Object.entries(input) as Array<[string, NormalizedAttrValue]>,
    );
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): NormalizedAttrValue | undefined {
    return this.map.get(key);
  }

  /**
   * Gets a parsed JSON value for the given attribute key.
   * Result is memoized for subsequent calls.
   *
   * @param key - Attribute key
   * @param maxSafeSize - Maximum size in characters to attempt JSON parsing (default: 2MB)
   * @returns Parsed JSON value, or the original value if not JSON or too large.
   */
  getParsed(key: string, maxSafeSize = 2_000_000): unknown {
    if (this.parsedCache.has(key)) {
      return this.parsedCache.get(key);
    }

    const val = this.map.get(key);
    if (typeof val !== "string") {
      return val;
    }

    const trimmed = val.trim();
    if (trimmed.length < 2) return val;

    // Fast check if it looks like JSON
    const looksJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));

    if (!looksJson) return val;

    // Safety guard for large strings to avoid blocking the event loop
    if (trimmed.length > maxSafeSize) {
      console.warn(
        `Attribute ${key} is too large for synchronous JSON parsing (${trimmed.length} chars). Skipping.`,
      );
      return val;
    }

    try {
      const parsed = JSON.parse(trimmed);
      this.parsedCache.set(key, parsed);
      return parsed;
    } catch {
      this.parsedCache.set(key, val);
      return val;
    }
  }

  take(key: string): NormalizedAttrValue | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.parsedCache.delete(key);
    }
    return v;
  }

  takeAny(
    keys: readonly string[],
  ): { key: string; value: NormalizedAttrValue } | null {
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
