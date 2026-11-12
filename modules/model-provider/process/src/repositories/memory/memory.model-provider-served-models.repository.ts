import { nowInstant } from "@langwatch/time";

import {
  ModelProviderServedModelsRepository,
  type ServedModelListing,
} from "../model-provider-served-models.repository.ts";

/** The Redis cache's memory twin: listings held in this process until they expire. */
export class MemoryModelProviderServedModelsRepository extends ModelProviderServedModelsRepository {
  static create(): MemoryModelProviderServedModelsRepository {
    return new MemoryModelProviderServedModelsRepository();
  }

  readonly #listings = new Map<string, { listing: ServedModelListing; expiresAt: number }>();

  private constructor() {
    super();
  }

  findListings(input: { keys: readonly string[] }): Promise<ServedModelListing[]> {
    const now = nowInstant().epochMilliseconds;
    const held = input.keys.flatMap((key) => {
      const entry = this.#listings.get(key);
      return entry && entry.expiresAt > now ? [entry.listing] : [];
    });
    return Promise.resolve(held);
  }

  saveListing(input: ServedModelListing & { ttlSeconds: number }): Promise<void> {
    const { ttlSeconds, ...listing } = input;
    this.#listings.set(listing.key, {
      listing,
      expiresAt: nowInstant().epochMilliseconds + ttlSeconds * 1000,
    });
    return Promise.resolve();
  }
}
