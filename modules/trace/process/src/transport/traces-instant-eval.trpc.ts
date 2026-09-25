/**
 * The server half of `traces.instantEval.*`. Permissions match the REST family:
 * `analytics:manage` to spend, `analytics:view` to read a run back.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { TraceApi, tracesInstantEvalTrpc } from "@langwatch/trace-contract";

export const tracesInstantEvalTrpcTransport = defineTrpcRouter(TraceApi, tracesInstantEvalTrpc)
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
