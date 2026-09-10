/**
 * The server half of `gatewayGuardrails.*`: the administrative surface behind
 * /gateway/guardrails. A virtual key opts in through
 * `config.guardrailAttachments[]`.
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GatewayApi, gatewayGuardrailTrpc } from "@langwatch/gateway-contract";

export const gatewayGuardrailTrpcTransport = defineTrpcRouter(GatewayApi, gatewayGuardrailTrpc)
  .procedure("list")
  .withPermission("gatewayGuardrails:view")
  .handle(({ app, input }) => app.listGuardrails(input.projectId))

  .procedure("get")
  .withPermission("gatewayGuardrails:view")
  .handle(({ app, input }) => app.findGuardrail({ id: input.id, projectId: input.projectId }))

  .procedure("create")
  .withPermission("gatewayGuardrails:manage")
  .handle(({ app, input, actor }) =>
    app.createGuardrail({
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      evaluatorId: input.evaluatorId,
      direction: input.direction,
      failureMode: input.failureMode,
      actorUserId: actor.id,
    }),
  )

  .procedure("update")
  .withPermission("gatewayGuardrails:manage")
  .handle(({ app, input, actor }) =>
    app.updateGuardrail({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      evaluatorId: input.evaluatorId,
      direction: input.direction,
      failureMode: input.failureMode,
      actorUserId: actor.id,
    }),
  )

  .procedure("archive")
  .withPermission("gatewayGuardrails:manage")
  .handle(async ({ app, input, actor }) => {
    await app.archiveGuardrail({
      id: input.id,
      projectId: input.projectId,
      actorUserId: actor.id,
    });

    return { ok: true as const };
  })
  .build();
