import type { TakenVoiceNonce, VoiceNonceRepository } from "../voice-nonce.repository.ts";

/** The Redis nonce store in memory: each entry lapses at its TTL on the injected clock. */
export class MemoryVoiceNonceRepository implements VoiceNonceRepository {
  private readonly entries = new Map<string, { registration: string; expiresAt: number }>();

  static create(options: { now?: () => number } = {}): MemoryVoiceNonceRepository {
    return new MemoryVoiceNonceRepository(options.now ?? Date.now);
  }

  private constructor(private readonly now: () => number) {}

  store(input: { nonce: string; registration: string; ttlSeconds: number }): Promise<void> {
    this.entries.set(input.nonce, {
      registration: input.registration,
      expiresAt: this.now() + input.ttlSeconds * 1000,
    });
    return Promise.resolve();
  }

  take(nonce: string): Promise<TakenVoiceNonce> {
    const entry = this.entries.get(nonce);
    this.entries.delete(nonce);
    if (!entry || this.now() >= entry.expiresAt) return Promise.resolve({ taken: false });
    return Promise.resolve({ taken: true, registration: entry.registration });
  }

  discard(nonce: string): Promise<void> {
    this.entries.delete(nonce);
    return Promise.resolve();
  }
}
