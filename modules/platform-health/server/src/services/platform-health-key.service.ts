import { timingSafeEqual } from "node:crypto";

/**
 * Constant time, so a caller cannot learn the key one byte at a time. A length
 * mismatch is refused first: `timingSafeEqual` requires equal lengths, and a
 * key of the wrong length is already not this key.
 */
export class PlatformHealthKeyService {
  readonly #expected: Buffer;

  private constructor(expected: string) {
    this.#expected = Buffer.from(expected);
  }

  static create(options: { apiKey: string }): PlatformHealthKeyService {
    return new PlatformHealthKeyService(options.apiKey);
  }

  accepts(presented: string | null | undefined): boolean {
    if (!presented || this.#expected.length === 0) return false;
    const candidate = Buffer.from(presented);
    if (candidate.length !== this.#expected.length) return false;
    return timingSafeEqual(candidate, this.#expected);
  }
}
