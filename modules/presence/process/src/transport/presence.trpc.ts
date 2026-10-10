import {
  defineMiddlewareContext,
  defineTrpcRouter,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import { PresenceApi, presenceTrpc, type PresenceUser } from "@langwatch/presence-contract";
import { z } from "zod";

const accepted = { ok: true } as const;

/** The signed-in person the door binds under this name, as langy and onboarding declare it. */
export const presenceSessionPersonContext = defineMiddlewareContext(
  "organizationSessionPerson",
  z.object({ name: z.string().nullable(), image: z.string().nullable() }).nullable(),
);

type SessionPerson = z.infer<typeof presenceSessionPersonContext.schema>;

/** The presenter: the authenticated id, with the session's name and image, never the payload's. */
function presenterOf(actor: TrpcHandlerActor, person: SessionPerson): PresenceUser {
  return { id: actor.id, name: person?.name ?? null, image: person?.image ?? null };
}

export const presenceTrpcTransport: TrpcRouterDeclaration<PresenceApi, typeof presenceTrpc> =
  defineTrpcRouter(PresenceApi, presenceTrpc)
    .procedure("update")
    .withMiddlewareContext(presenceSessionPersonContext)
    .withPermission("traces:view")
    .handle(async ({ app, input, actor }, person) => {
      await app.update({ ...input, user: presenterOf(actor, person) });

      return accepted;
    })

    .procedure("leave")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor }) => {
      await app.leave({ ...input, userId: actor.id });

      return accepted;
    })

    .procedure("cursor")
    .withMiddlewareContext(presenceSessionPersonContext)
    .withPermission("traces:view")
    .handle(async ({ app, input, actor }, person) => {
      await app.broadcastCursor({ ...input, user: presenterOf(actor, person) });

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

    .procedure("onOrganizationReadHints")
    .withPermission("organization:view")
    .handle(({ app, input, actor, signal }) =>
      app.readHints({
        userId: actor.id,
        organizationId: input.organizationId,
        ...(signal === undefined ? {} : { signal }),
      }),
    )

    .procedure("onProjectReadHints")
    .withPermission("project:view")
    .handle(({ app, input, actor, signal }) =>
      app.readHints({
        userId: actor.id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        ...(signal === undefined ? {} : { signal }),
      }),
    )

    // Platform-scoped: no tenant in the input, the door asks the operator view grant.
    .procedure("onUpgradeReadHints")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, signal }) => app.upgradeReadHints(signal === undefined ? {} : { signal }))
    .build();
