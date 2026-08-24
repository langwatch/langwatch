/**
 * The better-auth seam (ADR-101 §2): its own subpath so the root entry does
 * not force better-auth's shapes onto every importer of the services. The
 * app binds `IdentityCeremonies` to four of better-auth's own
 * `databaseHooks` in one place, its identity runtime.
 */
export type {
  IdentityCeremonyClock,
  IdentityWriteGate,
} from "./better-auth/ceremony-types";
export { IdentityCeremonies } from "./better-auth/identity-ceremonies";
