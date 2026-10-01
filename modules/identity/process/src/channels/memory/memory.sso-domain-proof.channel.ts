import type { SsoDomainProofChannel, SsoDomainTxtLookup } from "../sso-domain-proof.channel.ts";

/**
 * The published proof, in memory: a name answers what a test seeded, and a
 * name nothing seeded is absent — which is what an unpublished record is.
 */
export class MemorySsoDomainProofChannel implements SsoDomainProofChannel {
  readonly asked: string[] = [];
  private readonly answers = new Map<string, SsoDomainTxtLookup>();

  private constructor() {}

  static create(): MemorySsoDomainProofChannel {
    return new MemorySsoDomainProofChannel();
  }

  /** States the values published at one verification name. */
  seedPublished({ name, values }: { name: string; values: readonly string[] }): void {
    this.answers.set(name, { outcome: "published", values: [...values] });
  }

  /** States that the lookup at one name fails to happen at all. */
  seedUnreachable({ name, reason }: { name: string; reason: string }): void {
    this.answers.set(name, { outcome: "unreachable", reason });
  }

  async lookupTxtValues({ name }: { domain: string; name: string }): Promise<SsoDomainTxtLookup> {
    this.asked.push(name);

    return this.answers.get(name) ?? { outcome: "absent" };
  }
}
