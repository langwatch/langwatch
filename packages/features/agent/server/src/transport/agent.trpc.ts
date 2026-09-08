import { AgentApi, agentTrpc } from "@langwatch/agent-contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";

function withLegacyCopyCount<T extends { copyCount?: number }>(agent: T) {
  return { ...agent, _count: { copiedAgents: agent.copyCount ?? 0 } };
}

export const agentTrpcTransport = defineTrpcRouter(AgentApi, agentTrpc)
  .procedure("getAll")
  .withPermission("evaluations:view")
  .handle(async ({ app, input, actor }) => {
    const agents = await app.getAll({ ...input, viewerUserId: actor.id });

    return agents.map(withLegacyCopyCount);
  })

  .procedure("getById")
  .withPermission("evaluations:view")
  .handle(async ({ app, input, actor }) => {
    const agent = await app.getById({ ...input, viewerUserId: actor.id });

    return withLegacyCopyCount(agent);
  })

  .procedure("create")
  .withPermission("evaluations:manage")
  .handle(({ app, input }) => app.create(input))

  .procedure("update")
  .withPermission("evaluations:manage")
  .handle(({ app, input }) => app.update(input))

  .procedure("getRelatedEntities")
  .withPermission("evaluations:view")
  .handle(({ app, input }) => app.relatedEntities(input))

  .procedure("cascadeArchive")
  .withPermission("evaluations:manage")
  .handle(({ app, input }) => app.cascadeArchive(input))

  .procedure("delete")
  .withPermission("evaluations:manage")
  .handle(({ app, input }) => app.archive(input))

  .procedure("getCopies")
  .withPermission("evaluations:view")
  .handle(({ app, input, actor }) => app.getCopiesForActor({ ...input, actorId: actor.id }))

  .procedure("copy")
  .withPermission("evaluations:manage")
  .handle(({ app, input, actor }) =>
    app.copyForActor({
      sourceAgentId: input.agentId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.projectId,
      newAgentId: input.newAgentId,
      actorUserId: actor.id,
      actorId: actor.id,
    }),
  )

  .procedure("pushToCopies")
  .withPermission("evaluations:manage")
  .handle(({ app, input, actor }) => app.pushToCopiesForActor({ ...input, actorId: actor.id }))

  .procedure("syncFromSource")
  .withPermission("evaluations:manage")
  .handle(({ app, input, actor }) => app.syncFromSourceForActor({ ...input, actorId: actor.id }))

  .procedure("getHistory")
  .withPermission("evaluations:view")
  .handle(({ app, input }) => app.getHistory(input))

  .procedure("testTurn")
  .withPermission("evaluations:manage")
  .handle(({ app, input, actor }) => app.testTurn({ ...input, actorId: actor.id }))

  .procedure("testRun")
  .withPermission("scenarios:create")
  .handle(({ app, input, actor }) => app.testRun({ ...input, actorId: actor.id }))
  .build();
