import { createHash } from "node:crypto";

import { nowInstant } from "@langwatch/time";

import type { ModelProviderServedModelsRepository } from "../../../repositories/model-provider-served-models.repository.ts";
import type { ModelProviderModelList } from "./http-model-provider-model-list.service.ts";

/** A provider credential whose model list is asked for. */
export type ServedModelsCredential = Readonly<{
  provider: string;
  customKeys: Record<string, unknown>;
}>;

/** After this a held list is still answered, and asked again in the background. */
const FRESH_MS = 6 * 60 * 60 * 1000;
/** How long a list is held at all; a credential nobody reads for a week is dropped. */
const LISTING_TTL_SECONDS = 7 * 24 * 60 * 60;
/** A provider that did not answer is asked again after this, not on every read. */
const NO_ANSWER_TTL_SECONDS = 10 * 60;
/** How long a read waits on a first listing before answering without it. */
const FIRST_LIST_WAIT_MS = 2_500;

/** The cache key: a hash of the credential, so a new key or endpoint is a new listing. */
export function servedModelsKey({ provider, customKeys }: ServedModelsCredential): string {
  const fields = Object.entries(customKeys)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .toSorted(([left], [right]) => left.localeCompare(right));
  return createHash("sha256")
    .update(JSON.stringify([provider, fields]))
    .digest("hex");
}

/**
 * Which models each provider's own list says its credential can call, cached per credential.
 * Every failure answers nothing, so a picker falls back to the catalogue rather than emptying.
 */
export class ModelProviderServedModelsService {
  static create(input: {
    modelList: ModelProviderModelList;
    listings: ModelProviderServedModelsRepository;
    firstListWaitMs?: number;
  }): ModelProviderServedModelsService {
    return new ModelProviderServedModelsService(
      input.modelList,
      input.listings,
      input.firstListWaitMs ?? FIRST_LIST_WAIT_MS,
    );
  }

  readonly #inFlight = new Map<string, Promise<readonly string[]>>();

  private constructor(
    private readonly modelList: ModelProviderModelList,
    private readonly listings: ModelProviderServedModelsRepository,
    private readonly firstListWaitMs: number,
  ) {}

  /** Per provider key, the ids its list answered with; a provider with no answer is absent. */
  async getServedModels(
    credentials: readonly ServedModelsCredential[],
  ): Promise<Record<string, string[]>> {
    const keyed = credentials.map((credential) => ({
      credential,
      key: servedModelsKey(credential),
    }));
    const held = await this.listings
      .findListings({ keys: keyed.map(({ key }) => key) })
      .catch(() => []);
    const heldByKey = new Map(held.map((listing) => [listing.key, listing]));
    const now = nowInstant().epochMilliseconds;

    const answers = await Promise.all(
      keyed.map(async ({ credential, key }) => {
        const listing = heldByKey.get(key);
        if (listing) {
          if (now - listing.listedAt > FRESH_MS) void this.#ask({ credential, key });
          return [credential.provider, listing.ids] as const;
        }
        return [
          credential.provider,
          await this.#waitBriefly(this.#ask({ credential, key })),
        ] as const;
      }),
    );
    const served: Record<string, string[]> = {};
    for (const [provider, ids] of answers) {
      if (ids.length > 0) served[provider] = [...ids];
    }
    return served;
  }

  /** Asks again now, whatever is held: a saved provider may serve different models. */
  async refresh(credential: ServedModelsCredential): Promise<void> {
    await this.#ask({ credential, key: servedModelsKey(credential) });
  }

  #ask({
    credential,
    key,
  }: {
    credential: ServedModelsCredential;
    key: string;
  }): Promise<readonly string[]> {
    const running = this.#inFlight.get(key);
    if (running) return running;
    const asking = this.modelList
      .findServedModelIds(credential)
      .catch(() => [])
      .then(async (ids) => {
        await this.listings
          .saveListing({
            key,
            ids,
            listedAt: nowInstant().epochMilliseconds,
            ttlSeconds: ids.length > 0 ? LISTING_TTL_SECONDS : NO_ANSWER_TTL_SECONDS,
          })
          .catch(() => undefined);
        return ids;
      })
      .finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, asking);
    return asking;
  }

  #waitBriefly(asking: Promise<readonly string[]>): Promise<readonly string[]> {
    return Promise.race([
      asking,
      new Promise<readonly string[]>((resolve) => {
        setTimeout(() => resolve([]), this.firstListWaitMs).unref?.();
      }),
    ]);
  }
}
