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

/** What `this.trpc` actually is, before the optional namespaces are pinned present. */
type RawAppRouter = ApiApplication["trpc"];

/**
 * `ApiApplication["trpc"]`'s constructor spreads `agents` and `secrets` in
 * only when their service was supplied, so both are typed optional — a
 * process CAN mount neither, for a test or a degraded composition. A real
 * deployment always mounts both (`api.entrypoint.ts` never calls
 * `ApiApplication.create` without them), so a browser client built against
 * the optional type reads every namespace as `Router | undefined` and fails
 * to compile at its first call site (`'secretApi.secrets' is possibly
 * 'undefined'`).
 *
 * A shallow `Required<>` on `ApiApplication["trpc"]` is not enough: tRPC's
 * generated React Query proxy (`DecorateRouterRecord` in
 * `@trpc/react-query`'s `createTRPCReact.tsx`) reads namespace names off
 * `TRouter["_def"]["record"]`, not off the router's own top-level keys, and a
 * homomorphic mapped type over that record preserves the same `?` modifier
 * `router()`'s inferred parameter type gave it. So `_def.record` (and
 * `_def.procedures`, which server-side callers read the same way) need the
 * same treatment as the router's own top-level keys, not just those keys.
 */
type PinPresent<TRecord> = { [TKey in keyof TRecord]-?: TRecord[TKey] };

export type AppRouter = Omit<RawAppRouter, "_def"> &
  PinPresent<RawAppRouter> & {
    _def: Omit<RawAppRouter["_def"], "record" | "procedures"> & {
      record: PinPresent<RawAppRouter["_def"]["record"]>;
      procedures: PinPresent<RawAppRouter["_def"]["procedures"]>;
    };
  };
