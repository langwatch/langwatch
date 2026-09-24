/**
 * The server half of `sharedTrace.*`: the one trace read the open internet can
 * drive (ADR-057). Who is asking arrives as facts the process binds.
 */
import { publicRoute } from "@langwatch/api/access";
import { callerAddressFact, defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { sharedTraceTrpc, TraceApi } from "@langwatch/trace-contract";
import { z } from "zod";

/**
 * The signed-in caller's user id (an ORGANIZATION or PROJECT link admits only
 * members) and `user-agent` (folded into the hashed refresh-dedupe key).
 */
export const shareViewerFact = defineTrpcFact(
  "shareViewer",
  z.object({ userId: z.string().nullable(), userAgent: z.string().nullable() }),
);

const TOKEN_IS_THE_AUTHORIZATION = publicRoute({
  reason:
    "the share token in the input is the whole authorization; audience, expiry, view cap and the kill switch are checked on every read (ADR-057)",
});

export const sharedTraceTrpcTransport = defineTrpcRouter(TraceApi, sharedTraceTrpc)
  .procedure("get")
  .withFacts(callerAddressFact, shareViewerFact)
  .withAccess(TOKEN_IS_THE_AUTHORIZATION)
  .handle(({ app, input }, clientIp, viewer) =>
    app.getSharedTrace({
      token: input.token,
      viewerUserId: viewer.userId,
      clientIp,
      userAgent: viewer.userAgent,
    }),
  )
  .build();
