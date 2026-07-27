/**
 * The router the mobile app talks to.
 *
 * It is `appRouter`'s ops namespace and nothing else, mounted separately at
 * `/api/mobile/trpc` (see `src/server/routes/mobile-trpc.ts`) — the SAME
 * `opsRouter` instance the web console uses, so there is one implementation of
 * every ops query and no mirror to keep in sync.
 *
 * WHY IT IS NARROW. The mobile mount authenticates a device-flow bearer token
 * rather than a session cookie. Those tokens exist for the CLI, where they
 * unlock a handful of explicit `/api/auth/cli/*` endpoints; pointing them at
 * the whole `appRouter` would silently turn every one already in a developer's
 * keyring into a credential for the entire product API. Scoping the mount to
 * this router keeps a lost phone's blast radius to what an operator can already
 * read on the ops page, and makes widening it a deliberate edit here rather
 * than a side effect of adding a procedure somewhere else.
 *
 * Note this bounds the ROUTER, not the permissions: every procedure still runs
 * its own `ops:view` / `ops:manage` check, so a non-operator with a valid token
 * gets FORBIDDEN exactly as they would on the web.
 *
 * Spec: specs/ops/mobile-ops-api.feature
 */
import { createTRPCRouter } from "~/server/api/trpc";

import { opsRouter } from "./routers/ops";

export const mobileRouter = createTRPCRouter({
  ops: opsRouter,
});

/** Client-side type import target for the Expo app in `mobile/`. */
export type MobileRouter = typeof mobileRouter;
