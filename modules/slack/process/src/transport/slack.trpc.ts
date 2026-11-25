/**
 * The server half of `slackIntegration.*` (ADR-093 §5a). Every procedure opens
 * at `project:view`, as main's did; who may change which connection is
 * {@link SlackApi}'s call, since it depends on the connection's scope.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { SlackApi, slackIntegrationTrpc } from "@langwatch/slack-contract";

export const slackIntegrationTrpcTransport: TrpcRouterDeclaration<
  SlackApi,
  typeof slackIntegrationTrpc
> = defineTrpcRouter(SlackApi, slackIntegrationTrpc)
  .procedure("list")
  .withPermission("project:view")
  .handle(({ app, input, actor }) =>
    app.listSlackConnections({ projectId: input.projectId, actorId: actor.id }),
  )

  .procedure("create")
  .withPermission("project:view")
  .handle(({ app, input, actor }) => app.createSlackConnection({ ...input, actorId: actor.id }))

  .procedure("update")
  .withPermission("project:view")
  .handle(({ app, input, actor }) => app.updateSlackConnection({ ...input, actorId: actor.id }))

  .procedure("delete")
  .withPermission("project:view")
  .handle(({ app, input, actor }) =>
    app.deleteSlackConnection({ projectId: input.projectId, id: input.id, actorId: actor.id }),
  )
  .build();
