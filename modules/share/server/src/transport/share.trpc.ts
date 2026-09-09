/**
 * The server half of `share.*`: a permission and a handler per procedure the
 * contract already named. The domain guards (sharing kill switch, thread
 * derivation, allowlist) live in the app and surface as HandledErrors (ADR-057).
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ShareApi, shareTrpc } from "@langwatch/share-contract";

export const shareTrpcTransport = defineTrpcRouter(ShareApi, shareTrpc)
  /**
   * Requires `traces:share` (not `traces:view`): the list re-displays the
   * secret tokens, so only someone who can mint or revoke may enumerate them.
   */
  .procedure("listForResource")
  .withPermission("traces:share")
  .handle(async ({ app, input }) => app.listForResource(input))

  .procedure("createShare")
  .withPermission("traces:share")
  .handle(async ({ app, input, actor }) =>
    app.createShare({
      projectId: input.projectId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      visibility: input.visibility,
      expiresAt: input.expiresAt ?? null,
      maxViews: input.maxViews ?? null,
      userId: actor.id,
    }),
  )

  .procedure("revoke")
  .withPermission("traces:share")
  .handle(async ({ app, input }) => {
    await app.revokeById(input);
  })

  .procedure("revokeAllTraceShares")
  .withPermission("project:update")
  .handle(async ({ app, input }) => {
    await app.revokeAllTraceShares(input.projectId);
  })
  .build();
