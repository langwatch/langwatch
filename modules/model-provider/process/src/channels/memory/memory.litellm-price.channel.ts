import { LitellmPriceChannel, type LitellmPriceRegistry } from "../litellm-price.channel.ts";

const NOTHING_BOUND: LitellmPriceRegistry = {
  outcome: "unavailable",
  reason: "transport_failed",
  detail: "no litellm registry is bound to this memory channel",
};

/** A twin with no registry behind it unless a test hands it one. */
export class MemoryLitellmPriceChannel extends LitellmPriceChannel {
  private constructor(private readonly registry: LitellmPriceRegistry) {
    super();
  }

  static create({
    registry = NOTHING_BOUND,
  }: { registry?: LitellmPriceRegistry } = {}): MemoryLitellmPriceChannel {
    return new MemoryLitellmPriceChannel(registry);
  }

  async fetchPriceRegistry(): Promise<LitellmPriceRegistry> {
    return this.registry;
  }
}
