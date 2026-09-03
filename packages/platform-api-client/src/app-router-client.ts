import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@langwatch/platform-api/app-trpc/types";

/**
 * The one typed tRPC client, built against the process's real root router.
 *
 * Every feature web package and `apps/ui` share this single instance rather
 * than each hand-writing a `*ApiMap` and calling `createFeatureApi<Map>()`:
 * `apps/api` now exports its router's TYPE (never a value — `AppRouter` is
 * `import type`-only end to end, see `apps/api/src/app-trpc/app-trpc.types.ts`),
 * so there is no more need to describe a procedure's shape by hand before a
 * hook can call it.
 *
 * The shell still supplies the transport: this package builds no client
 * instance, no base URL, no links. `trpcReact.Provider` is mounted once, by
 * the process shell, with a `TRPCClient<AppRouter>` built from `httpBatchLink`,
 * `sseSubscriptionLink` and superjson — exactly as `createFeatureApi`'s
 * consumers already did per feature. `createFeatureApi` itself is unaffected
 * and stays available for the packages that have not migrated to this client
 * yet.
 */
export const trpcReact = createTRPCReact<AppRouter>();
