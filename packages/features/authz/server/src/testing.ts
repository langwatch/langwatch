/**
 * Reserved for public test builders that do not expose the package's private
 * repository and adapter boundaries. Package-local tests import those seams
 * relatively instead.
 *
 * `AuthzCollectorService` and `PostgresAuthzAdapter` are already this
 * package's public composition surface (re-exported from `.`), not a private
 * boundary — another feature's integration suite that has to drive the real
 * engine's read side (e.g. a cutover org's grants) reaches them here rather
 * than the package root, so the import reads as a declared test seam.
 */
export { AuthzCollectorService } from "./services/authz-collector.service";
export { PostgresAuthzAdapter } from "./adapters/postgres.authz.adapter";
