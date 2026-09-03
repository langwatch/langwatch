/**
 * The API process's root tRPC router type, `import type`-only.
 *
 * Exposed through the `./app-trpc/types` subpath so a browser package can
 * build ONE typed client (`createTRPCReact<AppRouter>()`) against the real
 * router instead of the 38 hand-written `*ApiMap`s this replaces. Nothing here
 * is a value: the whole file erases at compile time, which is what keeps it
 * safe for `packages/architecture-lint/tests/frontend-boundary.unit.test.ts` —
 * that walk only follows VALUE imports, so this subpath never appears in it.
 *
 * `ApiApplication["trpc"]` is read off the class rather than restated, so this
 * type can never drift from what the process actually mounts.
 */
import type { ApiApplication } from "../api.application";

export type AppRouter = ApiApplication["trpc"];
