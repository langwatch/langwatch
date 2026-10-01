import type {
  SsoDomainFileFetch,
  SsoDomainProofFileChannel,
} from "../sso-domain-proof-file.channel.ts";

/**
 * The served proof, in memory: a url answers what a test seeded, and a url
 * nothing seeded is absent — which is what an unserved file is.
 */
export class MemorySsoDomainProofFileChannel implements SsoDomainProofFileChannel {
  readonly asked: string[] = [];
  private readonly answers = new Map<string, SsoDomainFileFetch>();

  private constructor() {}

  static create(): MemorySsoDomainProofFileChannel {
    return new MemorySsoDomainProofFileChannel();
  }

  /** States the lines one domain serves at the verification path. */
  seedServed({ url, values }: { url: string; values: readonly string[] }): void {
    this.answers.set(url, { outcome: "served", values: [...values] });
  }

  /** States that the fetch at one url never happens at all. */
  seedUnreachable({ url, reason }: { url: string; reason: string }): void {
    this.answers.set(url, { outcome: "unreachable", reason });
  }

  async fetchVerificationFile({
    url,
  }: {
    domain: string;
    url: string;
  }): Promise<SsoDomainFileFetch> {
    this.asked.push(url);

    return this.answers.get(url) ?? { outcome: "absent" };
  }
}
