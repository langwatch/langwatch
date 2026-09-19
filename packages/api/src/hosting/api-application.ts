/**
 * The API's whole surface, as one application: the tRPC lanes, every REST
 * family, and the API's own 404 last — registered here because only this
 * place knows every declaration has mounted (ARCHITECTURE.md §4).
 */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";

import { ClientAddress } from "../policy/client-address.ts";
import type { SecurityHeaders } from "../policy/security-headers.ts";
import type { RestHost } from "../rest/host.ts";
import { canonicalErrorAnswer } from "../rest/response.ts";
import { TrpcHost } from "../trpc/host.ts";
import { SseLane } from "../trpc/sse.ts";
import type { HttpFailureAnswer } from "./http-mux.ts";
import { openapiDocumentRoute } from "./openapi-document.ts";

/** The tRPC lanes, then every REST family, then the 404 — mount order is match order. */
export function composeApiApplication(
  hosts: {
    rest?: RestHost | undefined;
    trpc?: TrpcHost | undefined;
  },
  policies: { trpc?: SecurityHeaders; rest?: SecurityHeaders } = {},
): Hono {
  const root = new Hono();

  root.use("*", async (context, next) => {
    await next();

    const policy =
      context.req.path === TrpcHost.path || context.req.path.startsWith(`${TrpcHost.path}/`)
        ? policies.trpc
        : policies.rest;

    for (const [name, value] of Object.entries(policy?.headers ?? {})) context.header(name, value);
  });

  if (hosts.trpc) root.route("/", trpcLanes(hosts.trpc));

  if (hosts.rest) {
    root.get("/api/openapi.json", openapiDocumentRoute(hosts.rest.app));
    root.route("/", hosts.rest.app);
  }

  // An address under this prefix that nothing serves is the API's own 404,
  // never a page the browser application would try to route.
  root.all("*", (context) => context.json({ error: "not_found" }, 404));

  return root;
}

/**
 * How the API answers a failure that escaped its middleware or preceded it:
 * the SAME serializer the families answer through, so a client cannot tell
 * which layer failed — and never receives HTML for a pre-routing crash.
 */
export const answerApiFailure: HttpFailureAnswer = (failure) => canonicalErrorAnswer(failure);

/**
 * Both tRPC lanes over ONE composed router: the request lane at `/api/trpc`,
 * and the subscription lane at `/api/sse`, so a procedure is reachable live
 * exactly when it is reachable at all.
 */
function trpcLanes(trpc: TrpcHost): Hono {
  const app = new Hono();

  app.all(`${TrpcHost.path}/*`, (context) =>
    fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: context.req.raw,
      router: trpc.router,
      createContext: async () => {
        const address = ClientAddress.resolvedFor(context.req.raw);

        return trpc.context({ request: context.req.raw, ...(address ? { address } : {}) });
      },
    }),
  );

  const sse = SseLane.create({
    members: {
      procedureTypeAt: (path) => trpc.procedureTypeAt(path),
      createCaller: async ({ request, signal }) =>
        trpc.router.createCaller(
          // On the context AND in the caller's options: a subscription
          // procedure reads whichever its own transport gives it, and only
          // the context reaches one resolved through a v10-shaped caller.
          { ...(await trpc.context({ request, signal })), signal },
          signal ? { signal } : {},
        ),
    },
  });

  app.get("/api/sse/*", (context) => sse.answer(context.req.raw, context.res.headers));

  return app;
}
