import type {
  NormalizedAttributes,
  NormalizedAttrValue,
} from "../schemas/spans";

export class AttributeBag {
  private readonly map: Map<string, NormalizedAttrValue>;

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

  take(key: string): NormalizedAttrValue | undefined {
    const v = this.map.get(key);
    if (v !== undefined) this.map.delete(key);
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
