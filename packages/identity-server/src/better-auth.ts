/**
 * The better-auth seam (ADR-101 §2): its own subpath so the root entry does
 * not force better-auth's shapes onto every importer of the services. The
 * app binds `IdentityCeremonies` to four of better-auth's own
 * `databaseHooks` in one place, its identity runtime.
 */
export type { IdentityCeremonyClock } from "./better-auth/ceremony-types";
export {
  type BetterAuthAccountRow,
  toBetterAuthAccount,
} from "./better-auth/account-projection";
export {
  type AccountQuery,
  type AccountWhere,
  parseAccountQuery,
  UnsupportedAccountQueryError,
} from "./better-auth/account-queries";
export { IdentityAccountStore } from "./better-auth/account-store";
export {
  IdentityAccountAdapter,
  type RowEngine,
} from "./better-auth/identity-account-adapter";
export { IdentityCeremonies } from "./better-auth/identity-ceremonies";
