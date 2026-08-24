// The better-auth routing facade (ADR-101 §2): its own subpath so the root
// entry does not force better-auth's types onto every importer of the
// services. The app wires it once, in its identity runtime.
export { AccountCeremony } from "./better-auth/account-ceremony";
export { AdapterRows } from "./better-auth/adapter-rows";
export type {
  DbAdapter,
  IdentityCeremonyClock,
  IdentityWriteGate,
} from "./better-auth/adapter-types";
export { IdentityDatabase } from "./better-auth/identity-database";
export {
  createIdentityDatabase,
  type IdentityDatabaseDeps,
} from "./better-auth/identity-database.factory";
export { TransactionWriteGuard } from "./better-auth/transaction-write-guard";
export { UserCeremony } from "./better-auth/user-ceremony";
export {
  IdentityAdapterUnroutedWriteError,
  type Route,
  type RoutingTable,
  WRITE_OPERATIONS,
  WriteRouting,
  type WriteOperation,
} from "./better-auth/write-routing";
