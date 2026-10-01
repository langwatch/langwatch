import type {
  SsoIssuerDiscovery,
  SsoIssuerDiscoveryChannel,
} from "../sso-issuer-discovery.channel.ts";

/**
 * Discovery in memory: an issuer answers what a test seeded, and one nothing
 * seeded is unreachable — which is what an address nobody runs is.
 */
export class MemorySsoIssuerDiscoveryChannel implements SsoIssuerDiscoveryChannel {
  readonly asked: string[] = [];
  private readonly answers = new Map<string, SsoIssuerDiscovery>();

  private constructor() {}

  static create(): MemorySsoIssuerDiscoveryChannel {
    return new MemorySsoIssuerDiscoveryChannel();
  }

  /** States that one issuer answers as a provider. */
  seedReachable({ issuer }: { issuer: string }): void {
    this.answers.set(issuer, { reachable: true });
  }

  /** States why one issuer does not. */
  seedUnreachable({ issuer, reason }: { issuer: string; reason: string }): void {
    this.answers.set(issuer, { reachable: false, reason });
  }

  async discover({ issuer }: { issuer: string }): Promise<SsoIssuerDiscovery> {
    this.asked.push(issuer);

    return this.answers.get(issuer) ?? { reachable: false, reason: "host_refused" };
  }
}
