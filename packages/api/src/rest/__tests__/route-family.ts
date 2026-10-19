import type { Hono } from "hono";
import type { BlankEnv, BlankSchema } from "hono/types";

/**
 * `Hono.route` infers four generics from the mounted app, which costs the test program tens of
 * thousands of types. Naming them skips the inference; the app is mounted at the root as before.
 */
export function routeFamily({ host, family }: { host: Hono; family: Hono }): void {
  host.route<string, BlankEnv, BlankSchema, "/", "/">("/", family);
}
