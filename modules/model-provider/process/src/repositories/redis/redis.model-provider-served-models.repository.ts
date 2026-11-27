import type { RedisConnection } from "@langwatch/redis-client";

import {
  ModelProviderServedModelsRepository,
  type ServedModelListing,
} from "../model-provider-served-models.repository.ts";

const PREFIX = "model-provider:served-models:";

/** Model lists over the process's Redis, so every replica's picker reads one answer. */
export class RedisModelProviderServedModelsRepository extends ModelProviderServedModelsRepository {
  static create(redis: RedisConnection): RedisModelProviderServedModelsRepository {
    return new RedisModelProviderServedModelsRepository(redis);
  }

  readonly #redis: RedisConnection;

  private constructor(redis: RedisConnection) {
    super();
    this.#redis = redis;
  }

  async findListings(input: { keys: readonly string[] }): Promise<ServedModelListing[]> {
    // One GET per key: a cluster refuses an MGET whose keys hash to different slots.
    const values = await Promise.all(input.keys.map((key) => this.#redis.get(`${PREFIX}${key}`)));
    const listings: ServedModelListing[] = [];
    values.forEach((value, index) => {
      const parsed = parseListing(value);
      if (parsed) listings.push({ key: input.keys[index]!, ...parsed });
    });
    return listings;
  }

  async saveListing(input: ServedModelListing & { ttlSeconds: number }): Promise<void> {
    await this.#redis.set(
      `${PREFIX}${input.key}`,
      JSON.stringify({ ids: input.ids, listedAt: input.listedAt }),
      "EX",
      input.ttlSeconds,
    );
  }
}

function parseListing(
  value: string | null | undefined,
): { ids: string[]; listedAt: number } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { ids?: unknown; listedAt?: unknown };
    if (!Array.isArray(parsed.ids) || typeof parsed.listedAt !== "number") return undefined;
    return {
      ids: parsed.ids.filter((id): id is string => typeof id === "string"),
      listedAt: parsed.listedAt,
    };
  } catch {
    return undefined;
  }
}
