import { AgentApi, agentTrpc } from "@langwatch/agent-contract";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";

import {
  agentVersionsWithoutSecrets,
  agentWithFieldsWithoutSecrets,
  agentWithoutSecrets,
} from "../rules/agent-secrets.rules.ts";
import { agentCallerOf } from "../rules/agent-version-caller.rules.ts";

function withLegacyCopyCount<T extends { copyCount?: number }>(
  agent: T,
): T & { _count: { copiedAgents: number } } {
  return { ...agent, _count: { copiedAgents: agent.copyCount ?? 0 } };
}

export const agentTrpcTransport: TrpcRouterDeclaration<AgentApi, typeof agentTrpc> =
  defineTrpcRouter(AgentApi, agentTrpc)
    .procedure("getAll")
    .withPermission("evaluations:view")
    .handle(async ({ app, input, actor }) => {
      const agents = await app.getAll({ ...input, viewerUserId: actor.id });

      return agents.map(agentWithoutSecrets).map(withLegacyCopyCount);
    })

    .procedure("getById")
    .withPermission("evaluations:view")
    .handle(async ({ app, input, actor }) => {
      const agent = await app.getById({ ...input, viewerUserId: actor.id });

      return withLegacyCopyCount(agentWithoutSecrets(agent));
    })

    .procedure("create")
    .withPermission("evaluations:manage")
    .handle(({ app, input, actor }) => app.create({ ...input, caller: agentCallerOf(actor) }))

    .procedure("update")
    .withPermission("evaluations:manage")
    .handle(async ({ app, input, actor }) =>
      agentWithFieldsWithoutSecrets(await app.update({ ...input, caller: agentCallerOf(actor) })),
    )

    .procedure("cascadeArchive")
    .withPermission("evaluations:manage")
    .handle(({ app, input, actor }) =>
      app.cascadeArchive({ ...input, caller: agentCallerOf(actor) }),
    )

    .procedure("delete")
    .withPermission("evaluations:manage")
    .handle(({ app, input, actor }) => app.archive({ ...input, caller: agentCallerOf(actor) }))

    .procedure("getCopies")
    .withPermission("evaluations:view")
    .handle(({ app, input, actor }) => app.getCopiesForActor({ ...input, actorId: actor.id }))

    .procedure("pushToCopies")
    .withPermission("evaluations:manage")
    .handle(({ app, input, actor }) => app.pushToCopiesForActor({ ...input, actorId: actor.id }))

    .procedure("syncFromSource")
    .withPermission("evaluations:manage")
    .handle(({ app, input, actor }) => app.syncFromSourceForActor({ ...input, actorId: actor.id }))

    .procedure("getHistory")
    .withPermission("evaluations:view")
    .handle(({ app, input }) => app.getHistory(input))

    .procedure("listVersions")
    .withPermission("evaluations:view")
    .handle(async ({ app, input }) => agentVersionsWithoutSecrets(await app.listVersions(input)))

    .procedure("assignLabel")
    .withPermission("agents:deploy")
    .handle(({ app, input, actor }) => app.assignLabel({ ...input, caller: agentCallerOf(actor) }))

    .procedure("removeLabel")
    .withPermission("agents:deploy")
    .handle(({ app, input }) => app.removeLabel(input))

    .build();
