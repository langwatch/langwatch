/**
 * This feature's tRPC namespace, off the one shared typed client.
 *
 * `apps/api` now exports its root router's TYPE (`AppRouter`, `import
 * type`-only) and `packages/platform-api-client` builds ONE
 * `createTRPCReact<AppRouter>()` against it — `trpcReact`. This package used
 * to hand-write `SecretApiMap` and call `createFeatureApi<SecretApiMap>()`
 * because that type did not exist; it does now, so the map is gone and this
 * file re-exports the shared client under this feature's existing name rather
 * than every call site changing.
 *
 * `secretApi` is deliberately the WHOLE client, not `trpcReact.secrets`:
 * `secrets.screen.tsx` calls `secretApi.useUtils()`, and `useUtils()` exists
 * only on the top-level client — a scoped `trpcReact.secrets` proxy has no
 * such method. `secretApi.secrets.list.useQuery(...)` still reads exactly as
 * it did, because `secrets` is still the mount point on the real root router
 * tRPC hashes into the React Query cache key.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 *
 * ## NO SECRET VALUE IS ON ANY SHAPE BELOW, IN EITHER DIRECTION OF A READ
 *
 * `Secret` is `{ id, projectId, name, createdAt, updatedAt, createdBy, updatedBy }`
 * and its schema is `.strict()` with the comment "Safe metadata. The encrypted
 * value is deliberately absent." — so a value cannot join a list answer by
 * accident; it would fail the parse. Values travel ONE WAY ONLY, on `create` and
 * `update`, and neither answers one back. That is the property this page exists
 * to keep, and `secret-api.unit.test.ts` asserts the shape of this boundary
 * rather than trusting the projection that satisfies it today.
 */

import { trpcReact } from "@langwatch/platform-api-client";

/**
 * The Secrets family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — it IS that
 * client, scoped to this feature's call sites by convention rather than by a
 * narrower type.
 */
export const secretApi = trpcReact;
