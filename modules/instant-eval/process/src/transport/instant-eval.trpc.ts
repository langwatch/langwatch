import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
/**
 * The server half of `instantEval.*`. Permissions match the REST family:
 * `analytics:manage` to spend, `analytics:view` to read; the opt-in switch is the
 * organization's consent, so it takes `organization:manage` via the project.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import type { Actor } from "@langwatch/authorization";
import {
  instantEvalTrpc,
  type ExplorerInstantEvalProgress,
  type ExplorerInstantEvalRunInput,
  type ExplorerSearchClassification,
  type ExplorerSearchClassificationInput,
  type InstantEvalApi,
  type InstantEvalEstimateWire,
} from "@langwatch/instant-eval-contract";
import { moduleApi } from "@langwatch/module";

/** What the Explorer's door reaches: the run service, and its runs in the search bar's words. */
export interface InstantEvalBrowserApi {
  /** This module's own application, as the process composed it. */
  instantEvals(): InstantEvalApi;
  /** The Explorer's shorthand, priced, judging nothing. */
  estimateExplorerRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<InstantEvalEstimateWire>;
  /** The same shorthand, accepted and queued; answers the run's counters. */
  startExplorerRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<ExplorerInstantEvalProgress>;
  /** Asks a run to stop. A run that already finished is refused by name. */
  cancelExplorerRun(input: {
    projectId: string;
    runId: string;
    requestedByUserId: string;
  }): Promise<ExplorerInstantEvalProgress>;
  /** One run's counters, which is all a chip and a progress bar read. */
  getExplorerRun(input: { projectId: string; runId: string }): Promise<ExplorerInstantEvalProgress>;
  /** A search-bar sentence classified for trace's router; never refuses, answers null instead. */
  classifySearch(
    input: ExplorerSearchClassificationInput & { actor: Actor },
  ): Promise<ExplorerSearchClassification>;
}

export const InstantEvalBrowserApi = moduleApi<InstantEvalBrowserApi>()("instant-eval");

export const instantEvalTrpcTransport: TrpcRouterDeclaration<
  InstantEvalBrowserApi,
  typeof instantEvalTrpc
> = defineTrpcRouter(InstantEvalBrowserApi, instantEvalTrpc)
  .procedure("estimate")
  .withPermission("analytics:manage")
  .handle(({ app, input, actor }) => app.estimateExplorerRun({ request: input, userId: actor.id }))

  .procedure("start")
  .withPermission("analytics:manage")
  .handle(({ app, input, actor }) => app.startExplorerRun({ request: input, userId: actor.id }))

  .procedure("cancel")
  .withPermission("analytics:manage")
  .handle(({ app, input, actor }) =>
    app.cancelExplorerRun({
      projectId: input.projectId,
      runId: input.runId,
      requestedByUserId: actor.id,
    }),
  )

  .procedure("get")
  .withPermission("analytics:view")
  .handle(({ app, input }) =>
    app.getExplorerRun({ projectId: input.projectId, runId: input.runId }),
  )

  .procedure("access")
  .withPermission("analytics:view")
  .handle(({ app, input, actor }) =>
    app.instantEvals().getOptInAccess({ projectId: input.projectId, userId: actor.id }),
  )

  .procedure("enable")
  // Main's row names the organization whose consent this is, not the project.
  .withAudit({ target: "organization", via: "projectId" })
  .withPermission({ kind: "permission", permission: "organization:manage", via: "projectId" })
  .handle(({ app, input, actor }) =>
    app.instantEvals().optIn({ projectId: input.projectId, userId: actor.id }),
  )

  .procedure("classifySearch")
  .withPermission("analytics:view")
  .handle(({ app, input, actor }) => app.classifySearch({ ...input, actor }))
  .build();
