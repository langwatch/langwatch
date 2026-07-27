/**
 * tRPC mount for the mobile app — `/api/mobile/trpc/*`.
 *
 * Same protocol and same transformer as `/api/trpc`, but two things differ:
 *
 *   1. AUTH. The caller presents `Authorization: Bearer lw_at_…`, the access
 *      token minted by the RFC 8628 device-authorization flow in `auth-cli.ts`,
 *      instead of a session cookie. The token resolves to a real user and this
 *      route synthesizes the `Session` the tRPC context expects, so every
 *      procedure's existing `protectedProcedure` and `ops:view` / `ops:manage`
 *      checks run unchanged. Cookies are deliberately NOT read here: a browser
 *      that happens to be signed in must not reach this mount cross-origin, and
 *      there is nothing behind it the web UI cannot already reach at /api/trpc.
 *
 *   2. SURFACE. It serves `mobileRouter` (the ops namespace), not `appRouter`.
 *      See that file for why the token is scoped rather than made a key to the
 *      whole product API.
 *
 * Mounted at its own path rather than under `/api/trpc/...` so there is no
 * wildcard-ordering dependency between the two mounts: `/api/trpc/*` would
 * otherwise swallow anything nested beneath it, and a route that works because
 * of registration order is one refactor away from not working.
 *
 * Spec: specs/ops/mobile-ops-api.feature
 */
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Context } from "hono";

import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { mobileRouter } from "~/server/api/mobile-root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import type { Session } from "~/server/auth";
import { validateCliAccessToken } from "~/server/auth/cliAccessToken";
import { prisma } from "~/server/db";
import { connection as redisConnection } from "~/server/redis";

export const MOBILE_TRPC_ENDPOINT = "/api/mobile/trpc";

/**
 * Resolve the bearer token to the session tRPC expects, or null.
 *
 * Null covers a missing, malformed, expired or revoked token and a token
 * pointing at a user that no longer exists. Collapsing all five into one answer
 * is deliberate — distinguishing them is free information for someone probing
 * tokens, and every one of them means the same thing to the client: sign in
 * again.
 *
 * No `impersonator` field: a device token is minted for exactly one identity
 * and carries no "acting as" concept, so unlike the cookie path there is never
 * a second email to resolve a grant against.
 */
async function sessionFromDeviceToken(req: Request): Promise<Session | null> {
  if (!redisConnection) return null;

  const record = await validateCliAccessToken({
    authHeader: req.headers.get("authorization"),
    redis: redisConnection,
  });
  if (!record) return null;

  const user = await prisma.user.findUnique({
    where: { id: record.user_id },
    select: { id: true, name: true, email: true, image: true },
  });
  if (!user) return null;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    },
    // The session is exactly as long-lived as the token behind it. Reporting
    // anything longer would have a client trust a credential the server has
    // already stopped honouring.
    expires: new Date(record.expires_at).toISOString(),
  };
}

/**
 * Minimal NextApiRequest-shaped shim. The audit-log and logger middlewares read
 * `ctx.req.headers[...]` and `ctx.req.socket.remoteAddress`; this exposes just
 * enough for them without pulling in a real Node IncomingMessage.
 */
function buildReqShim(req: Request): any {
  const url = new URL(req.url);
  const headers: Record<string, string | string[]> = {};
  req.headers.forEach((value, key) => {
    const existing = headers[key];
    if (existing) {
      headers[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      headers[key] = value;
    }
  });

  return {
    headers,
    method: req.method,
    url: url.pathname + url.search,
    query: Object.fromEntries(url.searchParams),
    socket: { remoteAddress: undefined },
  } as any;
}

/**
 * A tRPC-shaped error envelope for an exception that escaped the adapter — a
 * throw inside `createContext`, say. The body MUST be non-empty parseable JSON
 * or the client's `response.json()` throws `Unexpected end of JSON input`
 * instead of surfacing a `TRPCClientError`. The `json` key is the superjson
 * wrapper this app's transformer expects. Mirrors `routes/trpc.ts` (lw#5219).
 */
function trpcErrorEnvelope(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Internal server error";
  return {
    error: {
      json: {
        message,
        code: -32603,
        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
      },
    },
  };
}

const secured = createServiceApp({ basePath: "/api" });

const handler = async (c: Context) => {
  try {
    return await fetchRequestHandler({
      endpoint: MOBILE_TRPC_ENDPOINT,
      req: c.req.raw,
      router: mobileRouter,
      createContext: async ({ req }: FetchCreateContextFnOptions) => {
        return createInnerTRPCContext({
          req: buildReqShim(req),
          res: undefined,
          session: await sessionFromDeviceToken(req),
          permissionChecked: false,
          publiclyShared: false,
        });
      },
    });
  } catch (error) {
    return c.json(trpcErrorEnvelope(error), 500);
  }
};

const MOBILE_TRPC_POLICY = handlerManagedAuth(
  "Device-flow bearer token resolved to a session in-handler; tRPC then enforces per-procedure RBAC (ops:view / ops:manage)",
);

secured.access(MOBILE_TRPC_POLICY).get("/mobile/trpc/*", handler);
secured.access(MOBILE_TRPC_POLICY).post("/mobile/trpc/*", handler);

export const app = secured.hono;
