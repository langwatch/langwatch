import type { IdentityStorageAdapterInput } from "@langwatch/identity-contract";

/**
 * Better Auth's storage engine, one per tier: the stock engine and one real
 * transaction over it, which identity's storage adapter routes between.
 */
export abstract class BetterAuthStorageRepository {
  /** What `IdentityApi.createStorageAdapter` takes. */
  abstract engines(): IdentityStorageAdapterInput;
}
