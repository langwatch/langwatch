/**
 * The person a REST-started run is recorded against.
 *
 * Every family that starts a run reads the same two things off the request:
 * the user a key belongs to, and the surface the caller declared. Keeping the
 * read in one place is what stops one family recording an actor the others do
 * not.
 */
import type { Context } from "hono";

import {
  type RunActor,
  runActorFromRequest,
} from "~/server/scenarios/run-actor";

/**
 * The actor of this request, or nothing when the credential names no person.
 *
 * A user-bound key names the person it belongs to. A project key names nobody,
 * and the run records no actor at all.
 */
export function runActorOf(c: Context): RunActor | undefined {
  return runActorFromRequest({
    userId: c.get("apiKeyUserId"),
    surfaceHeader: c.req.header("X-LangWatch-Surface"),
  });
}
