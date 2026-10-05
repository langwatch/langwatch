/**
 * The server half of `traces.instantEval.*`. Permissions match the REST family:
 * `analytics:manage` to spend, `analytics:view` to read a run back. The
 * organization's switch consents for every project, so it takes the organization tier.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { TraceApi, tracesInstantEvalTrpc } from "@langwatch/trace-contract";

export const tracesInstantEvalTrpcTransport: TrpcRouterDeclaration<
  TraceApi,
  typeof tracesInstantEvalTrpc
> = defineTrpcRouter(TraceApi, tracesInstantEvalTrpc)
  .procedure("access")
  .withPermission("analytics:view")
  .handle(({ app, input, actor }) =>
    app.readExplorerEvalAccess({ projectId: input.projectId, userId: actor.id }),
  )

  .procedure("enable")
  .withPermission({ kind: "permission", permission: "organization:manage", via: "projectId" })
  .handle(({ app, input, actor }) =>
    app.enableExplorerEvals({ projectId: input.projectId, userId: actor.id }),
  )

  .procedure("estimate")
  .withPermission("analytics:manage")
  .handle(({ app, input, actor }) =>
    app.estimateExplorerEvalRun({ request: input, userId: actor.id }),
  )

  .procedure("start")
  .withPermission("analytics:manage")
  .handle(({ app, input, actor }) => app.startExplorerEvalRun({ request: input, userId: actor.id }))

  .procedure("cancel")
  .withPermission("analytics:manage")
  .handle(({ app, input, actor }) =>
    app.cancelExplorerEvalRun({
      projectId: input.projectId,
      runId: input.runId,
      requestedByUserId: actor.id,
    }),
  )

  .procedure("get")
  .withPermission("analytics:view")
  .handle(({ app, input }) =>
    app.getExplorerEvalRun({ projectId: input.projectId, runId: input.runId }),
  )
  .build();
