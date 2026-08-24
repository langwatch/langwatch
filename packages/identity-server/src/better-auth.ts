/**
 * The better-auth seam (ADR-101 §2, ADR-116): its own subpath so the root
 * entry does not force better-auth's shapes onto every importer of the
 * services.
 *
 * Two things live here, and they are the two halves of the same move.
 * `IdentityCeremonies` says what a row write MEANS, bound to better-auth's
 * `databaseHooks`. `createIdentityStorageAdapter` is better-auth's whole
 * `database:` entry — the implementation `createAdapterFactory` is built
 * around, in which a per-user gate routes between the stock behavior and
 * event-sourced storage. Being the factory's BASE is what makes the
 * library's own traffic (its join emulation, its transactions) land on it;
 * a wrapper over a finished adapter sits above that traffic and cannot see
 * it.
 *
 * No storage engine is implemented here either: the identity branch runs on
 * ports the app fills with Prisma, and the legacy branch delegates to
 * better-auth's own published engine.
 */
export type {
  CeremonyAccountRow,
  IdentityAccountCeremonies,
  IdentityCeremonyClock,
} from "./better-auth/ceremony-types";
export {
  type AccountQuery,
  type AccountWhere,
  IdentityUnsupportedStorageQueryError,
  parseAccountQuery,
} from "./better-auth/account-queries";
export { IdentityCeremonies } from "./better-auth/identity-ceremonies";
export {
  createIdentityStorageAdapter,
  type IdentityStorageAdapterDeps,
} from "./better-auth/identity-storage-adapter";
export type {
  IdentityAccountRow,
  IdentityAccountSecrets,
  IdentityAccountsPort,
  IdentityResolution,
  IdentityResolutionPort,
} from "./better-auth/storage-ports";
