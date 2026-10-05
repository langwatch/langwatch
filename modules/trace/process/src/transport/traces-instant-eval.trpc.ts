/**
 * The server half of `traces.instantEval.*`. Permissions match the REST family:
 * `analytics:manage` to spend, `analytics:view` to read; the opt-in switch is the
 * organization's consent, so it takes `organization:manage` via the project.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { TraceApi, tracesInstantEvalTrpc } from "@langwatch/trace-contract";

export const tracesInstantEvalTrpcTransport: TrpcRouterDeclaration<
  TraceApi,
  typeof tracesInstantEvalTrpc
> = defineTrpcRouter(TraceApi, tracesInstantEvalTrpc)
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

  .procedure("access")
  .withPermission("analytics:view")
  .handle(({ app, input, actor }) =>
    app.getExplorerEvalAccess({ projectId: input.projectId, userId: actor.id }),
  )

  .procedure("enable")
  // Main's row names the organization whose consent this is, not the project.
  .withAudit({ target: "organization", via: "projectId" })
  .withPermission({ kind: "permission", permission: "organization:manage", via: "projectId" })
  .handle(({ app, input, actor }) =>
    app.enableExplorerEvals({ projectId: input.projectId, userId: actor.id }),
  )
  .build();
