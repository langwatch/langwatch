// The better-auth routing facade (ADR-101 §2): its own subpath so the root
// entry does not force better-auth's types onto every importer of the
// services. The app wires it once, in its identity runtime.
export { createIdentityDatabase, type IdentityDatabaseDeps } from "./better-auth/adapter";
export { type DbAdapter, findAllRows, pinnedToIds } from "./better-auth/context";
export {
  IdentityAdapterUnroutedWriteError,
  ROUTED_MODELS,
  type Route,
  routeWrite,
  WRITE_OPERATIONS,
  type WriteOperation,
} from "./better-auth/routing";
