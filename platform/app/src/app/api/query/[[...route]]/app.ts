/**
 * The query domain's app.
 *
 * `createProjectApp`, because a project API key reaches exactly its own
 * project and that is the single-project slice this family ships first. The
 * cross-project fan-out (issue #7565) mounts on `createOrgApp` instead, which
 * is why the routes declare their permission through `handlerManagedAuth`
 * rather than a route-level `requires(...)` that would resolve at
 * organization scope there.
 *
 * The directory this file sits in is only where the repo keeps route modules,
 * and carries no routing meaning: the base path below is what mounts.
 *
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import type { Context } from "hono";

import {
  canonicalErrorFor,
  requestTraceIds,
} from "~/app/api/shared/canonical-error";
import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { registerQueryRoutes } from "./app.v1";
import { type QueryRpcVariables, rpcErrorBody } from "./rpc";

patchZodOpenapi();

/**
 * Version-first, unlike the families that predate it.
 *
 * `/api/v1/query` puts the version where every other platform route already
 * carries it, so a consumer holding a base URL does not learn two rules for
 * where `v1` lives. Issue #7565 originally specified `/api/query/v1` and was
 * corrected on purpose; the reversal is recorded on the issue rather than
 * left for a reader to rediscover here.
 */
const BASE_PATH = "/api/v1/query";

/**
 * The canonical envelope, because this is a new family.
 *
 * `legacy` is the flat `{ error }` shape the older families already published
 * and whose consumers parse it; nothing consumes this door yet, so there is
 * no such shape to preserve and the canonical one is what the rest of the
 * platform is converging on.
 */
const secured = createProjectApp<QueryRpcVariables>({
  basePath: BASE_PATH,
  errorEnvelope: "canonical",
});

registerQueryRoutes(secured);

/**
 * The family's own error handler, wrapping the canonical envelope in JSON-RPC.
 *
 * `SecuredApp` installs `canonicalErrorResponse` for us and explicitly invites
 * a family to replace it when the family's errors have a shape of their own.
 * That is this: a JSON-RPC client reads `error.code`, and a bare canonical body
 * has no such field, so an auth denial raised by middleware BELOW this handler
 * would otherwise reach the caller in a shape its parser cannot read.
 *
 * The canonical body is not replaced — it is carried through as `error.data`.
 * One failure, described once, readable by both parsers.
 *
 * The HTTP status stays the real one (403 stays 403). A JSON-RPC purist would
 * answer 200 and put everything in the body; this door answers to CLIs, curl
 * and proxies that route on status long before anything parses the envelope,
 * and making all of them read a body to learn a request was refused buys
 * conformance at the cost of every layer above.
 */
secured.hono.onError((error: unknown, c: Context) => {
  const { status, body } = canonicalErrorFor(error, requestTraceIds(c));
  return c.json(rpcErrorBody({ error, canonical: body, c }), status);
});

export const app = secured.hono;
