/** One provider credential's model list, as last asked; `ids` is empty when it did not answer. */
export type ServedModelListing = Readonly<{
  key: string;
  ids: readonly string[];
  listedAt: number;
}>;

/** The cached answers of providers' own model lists, keyed by a hash of the credential. */
export abstract class ModelProviderServedModelsRepository {
  /** The listings still held for these keys; a key with none held is absent. */
  abstract findListings(input: { keys: readonly string[] }): Promise<ServedModelListing[]>;
  abstract saveListing(input: ServedModelListing & { ttlSeconds: number }): Promise<void>;
}
