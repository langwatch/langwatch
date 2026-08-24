/**
 * The better-auth seam (ADR-101 §2, ADR-116): its own subpath so the root
 * entry does not force better-auth's shapes onto every importer of the
 * services.
 *
 * There is no adapter here. During ADR-116's bridge phase better-auth
 * reads and writes its own `account` table with the stock `prismaAdapter`;
 * what identity does is state a fact when better-auth is about to write a
 * row, through the three `databaseHooks` the app binds to
 * `IdentityCeremonies`. The `Account` row itself is a projection the fold
 * maintains (ADR-116), not something this package serves.
 */
export type { IdentityCeremonyClock } from "./better-auth/ceremony-types";
export { IdentityCeremonies } from "./better-auth/identity-ceremonies";
