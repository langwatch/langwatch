/**
 * `@langwatch/authz-server/migration` — the server-only subpath.
 *
 * The root entry is (indirectly) evaluated by the browser today: the app's
 * client bundle reaches `server/api/rbac.ts` through
 * `utils/permissionsConfig.ts`, and rbac pulls the shadow fork, which imports
 * this package. Everything on the root is therefore browser-evaluable by
 * construction — pure reducers, mappings, service classes. Grant identity
 * derivation is not (`node:crypto`, KSUID), so it lives here.
 *
 * The three rollout migrations that used to be exported from here — the
 * team-user backfill, the genesis import and the cutover — were deleted with
 * ADR-110, which replaces them with one migration that reads every legacy
 * table directly. Nothing is exported in their place until it is written.
 */
export { deriveGrantId } from "./ledger/grant-identity";
