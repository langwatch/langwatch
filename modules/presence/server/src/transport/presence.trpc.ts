/**
 * The server half of `presence.*`: a permission and a handler per procedure the
 * contract already named.
 *
 * Presence is a read-side view of who else is looking at the same project, so
 * seeing it — and being seen in it — takes exactly what seeing the traces
 * takes. Every procedure declares that one permission at the project tier.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { PresenceApi, presenceTrpc } from "@langwatch/presence-contract";

const accepted = { ok: true } as const;

export const presenceTrpcTransport = defineTrpcRouter(PresenceApi, presenceTrpc)
  .procedure("update")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    await app.update({ ...input, userId: actor.id });

    return accepted;
  })

  .procedure("leave")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    await app.leave({ ...input, userId: actor.id });

    return accepted;
  })

  .procedure("cursor")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    await app.broadcastCursor({ ...input, userId: actor.id });

    return accepted;
  })

  .procedure("onPresenceUpdate")
  .withPermission("traces:view")
  .handle(({ app, input, signal }) => app.events({ projectId: input.projectId, signal }))

  .procedure("onPresenceCursor")
  .withPermission("traces:view")
  .handle(({ app, input, signal }) =>
    app.cursors({
      projectId: input.projectId,
      anchor: input.anchor,
      sessionId: input.sessionId,
      signal,
    }),
  )
  .build();
