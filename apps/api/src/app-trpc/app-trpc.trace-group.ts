/**
 * The sixteen tRPC surfaces a project's OBSERVABILITY is read through, mounted
 * as one group on the process's own root.
 *
 *   traces / tracesV2 / spans / traceEditOverlay / sharedTrace
 *                        the captured trace itself: the legacy grid and its
 *                        reads, the explorer that replaced it, one trace's
 *                        spans, the reviewer's correction over a trace, and the
 *                        single anonymous read ADR-057 allows.
 *   share / pinnedTrace  the link a trace is shared by, and the traces somebody
 *                        pinned to come back to.
 *   savedViews           the filter sets the explorer remembers.
 *   topics               the clusters a project's traces were grouped into.
 *   costs / llmModelCost the spend those traces recorded, and the custom rules
 *                        that price them.
 *   modelProvider        the credentials the calls behind them ran on.
 *   translate            captured content, rendered in the reader's language.
 *   httpProxy            the studio's outbound call and the agent test that
 *                        writes its own trace.
 *   limits / plan        what this organization is allowed, and what it has
 *                        used against that allowance.
 *
 * ## Why one group rather than sixteen entries
 *
 * They are one graph. Every one of them either reads {@link TraceApp} or reads
 * something a trace read is measured against — the share that redeems an
 * anonymous view, the topic a row is labelled with, the plan window that hides
 * an old trace, the cost rule that prices a span. Naming them individually on
 * {@link AppTrpcFeaturePorts} would put sixteen entries and a dozen type
 * parameters on a file every other half of the record also edits; naming them
 * once here keeps the shared file's diff to one import, one parameter and one
 * spread, and keeps the group's own type parameters where the group is.
 *
 * ## The two subscriptions
 *
 * `traces.onTraceUpdate` and `tracesV2.onDiscoverUpdate` are in this record,
 * not beside it. A subscription mounted beside the record would be callable
 * over `/api/trpc` and un-watchable over `/api/sse`, because the SSE lane
 * resolves its path against a caller built from the record the process mounted.
 * Both stream off the tenant emitter the PROCESS owns, which is why they keep
 * working on a deployment whose trace read stack is absent: there is nothing to
 * read, but a browser still learns that something arrived.
 */
import type { TrpcApiMount, TrpcApiPublicMount } from "@langwatch/api/trpc";
import type { HttpProxyTrpcContext, HttpProxyTrpcPorts } from "@langwatch/agent-server";
import type {
  SavedViewTrpcContext,
  SavedViewTrpcPorts,
} from "@langwatch/dashboard-server";
import type {
  CostTrpcContext,
  CostTrpcPorts,
  LimitsTrpcContext,
  LimitsTrpcPorts,
  PlanTrpcContext,
} from "@langwatch/entitlement-server";
import type {
  LlmModelCostTrpcContext,
  LlmModelCostTrpcPorts,
  ModelProviderTrpcContext,
  ModelProviderTrpcPorts,
  TranslateTrpcContext,
  TranslateTrpcPorts,
} from "@langwatch/model-provider-server";
import type { PinnedTraceTrpcContext, ShareTrpcContext } from "@langwatch/share-server";
import type { TopicTrpcContext } from "@langwatch/topic-server";
import type { TraceLegacyFilterInput, TraceLegacyListInput } from "@langwatch/trace-contract";
import type {
  SharedTraceTrpcContext,
  SharedTraceTrpcPorts,
  SpansTrpcContext,
  SpansTrpcPorts,
  TraceEditOverlayTrpcContext,
  TraceEditOverlayTrpcPorts,
  TraceEditOverlayVisibilityWindow,
  TracesTrpcContext,
  TracesTrpcPorts,
  TracesV2TrpcContext,
  TracesV2TrpcPorts,
} from "@langwatch/trace-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

import { createHttpProxyTrpcRouter } from "../features/agent/http-proxy-trpc.mount";
import { createSavedViewTrpcRouter } from "../features/dashboard/dashboard-trpc.mount";
import {
  createCostTrpcRouter,
  createLimitsTrpcRouter,
  createPlanTrpcRouter,
} from "../features/entitlement/entitlement-trpc.mount";
import {
  createLlmModelCostTrpcRouter,
  createModelProviderTrpcRouter,
  type ModelProviderTrpcChecks,
} from "../features/model-provider/model-provider-trpc.mount";
import { createTranslateTrpcRouter } from "../features/model-provider/translate-trpc.mount";
import {
  createPinnedTraceTrpcRouter,
  createShareTrpcRouter,
} from "../features/share/share-trpc.mount";
import { createTopicTrpcRouter } from "../features/topic/topic-trpc.mount";
import {
  createSpansTrpcRouter,
  createTraceEditOverlayTrpcRouter,
  createTracesTrpcRouter,
} from "../features/trace/trace-trpc.mount";
import {
  createSharedTraceTrpcRouter,
  createTracesV2TrpcRouter,
} from "../features/trace/traces-v2-trpc.mount";

/**
 * The request context this group is resolved against: the intersection of the
 * sixteen surfaces' own contexts.
 *
 * Written down once for the same reason {@link ApiTrpcFeatureApplication} is —
 * so "what must a request carry for the whole group to mount" is one statement
 * rather than sixteen compile errors.
 */
export type AppTraceGroupTrpcContext = CostTrpcContext &
  HttpProxyTrpcContext &
  LimitsTrpcContext &
  LlmModelCostTrpcContext &
  ModelProviderTrpcContext &
  PinnedTraceTrpcContext &
  PlanTrpcContext &
  SavedViewTrpcContext &
  ShareTrpcContext &
  SharedTraceTrpcContext &
  SpansTrpcContext &
  TopicTrpcContext &
  TraceEditOverlayTrpcContext &
  TracesTrpcContext &
  TracesV2TrpcContext &
  TranslateTrpcContext;

/**
 * The capabilities the sixteen surfaces reach that their own feature packages
 * do not own.
 *
 * Four of them take NOTHING and are absent from this interface entirely —
 * `share`, `pinnedTrace`, `topics` and `plan` answer wholly from the
 * application slices on `ctx.app`. That is not an oversight to be tidied up
 * later: a surface with no port is a surface a deployment cannot get wrong.
 *
 * `tracesV2` omits `queryTranslation` because that port is Trace's own query
 * translator, filled in by the mount rather than by a host — it exists only
 * because the strict layout forbids a transport from importing its feature's
 * ClickHouse adapter, and there is no second implementation for a process to
 * choose between.
 */
export interface AppTraceGroupTrpcPorts<
  TListInput extends TraceLegacyListInput = TraceLegacyListInput,
  TListInputRaw = unknown,
  TFilterInput extends TraceLegacyFilterInput = TraceLegacyFilterInput,
  TFilterInputRaw = unknown,
  TPrecondition = unknown,
  TProtections extends TraceEditOverlayVisibilityWindow = TraceEditOverlayVisibilityWindow,
  TMetadata = unknown,
  TMetadataRaw = unknown,
  TSavedView = unknown,
  TSpendRollup = unknown,
  TApiKeyValidation = unknown,
  TStoredKeyValidation = unknown,
> {
  /**
   * The legacy trace grid's two shared input schemas, the evaluator wizard's
   * precondition engine, the readable span digest and the caller's redactions.
   *
   * The schemas are the PROCESS's rather than Trace's because the same shapes
   * are the v1 REST search body and the analytics read input: one definition,
   * held by the deployment, is what keeps those three surfaces from drifting.
   */
  traces: TracesTrpcPorts<TListInput, TListInputRaw, TFilterInput, TFilterInputRaw, TPrecondition>;
  /**
   * Everything the explorer reads that is another vertical's: the viewer's
   * redactions and the plan's visibility window, the span display and
   * redaction passes, Data Privacy's content-key catalogue, the coding-agent
   * log join, the AI composer, the reserved-metadata write, the unmapped-cost
   * suggestion and the prompt-ancestor walk.
   */
  tracesV2: Omit<TracesV2TrpcPorts<TMetadata, TMetadataRaw>, "queryTranslation">;
  /** The caller's read-time redactions, for the waterfall and the studio span. */
  spans: SpansTrpcPorts;
  /**
   * The same redactions, plus the two rules a correction is carried through.
   *
   * They are the rules the trace read applies to the captured value, so a
   * correction can never be handed over more freely than the content it
   * corrects — and the withheld half is put back on the way in, so saving over
   * a correction the reader only partly saw does not delete the rest of it.
   */
  traceEditOverlay: TraceEditOverlayTrpcPorts<TProtections>;
  /**
   * The anonymous read's own four: the shared mappers, the share viewer's
   * protections, the process's rate limiter and client-IP resolution, and the
   * predicate that turns a deleted trace into the same generic not-found a bad
   * token gets.
   */
  sharedTrace: SharedTraceTrpcPorts;
  /** The stored filter sets, generic in the row shape the explorer renders. */
  savedViews: SavedViewTrpcPorts<TSavedView>;
  /**
   * The organization's spend, rolled up per project and already narrowed to the
   * projects this caller can reach — which is membership, and therefore the
   * process's fact rather than Entitlement's.
   */
  costs: CostTrpcPorts<TSpendRollup>;
  /**
   * The cost rule's regex safety gate, the model registry's ceilings and the
   * live span preview behind the rule drawer.
   *
   * The safety gate is read while the router is BUILT — the write and preview
   * schemas are constructed from it — so it is the one entry here that a
   * deployment cannot leave to fail at call time.
   */
  llmModelCost: LlmModelCostTrpcPorts;
  /** The outbound credential probes, the Codex device flow and the audit trail. */
  modelProvider: ModelProviderTrpcPorts<TApiKeyValidation, TStoredKeyValidation>;
  /**
   * The two data-dependent gates the provider surface needs, already built.
   *
   * Middlewares rather than descriptions because each CLAIMS what enforces the
   * tenant anchor, and a claim has to be written where the enforcement is —
   * which is also why `declaredCheckFrom` refuses to build a custom check from
   * a description of one.
   */
  modelProviderChecks: ModelProviderTrpcChecks;
  /** The application's provider-failure policy behind one model call. */
  translate: TranslateTrpcPorts;
  /** The studio's event dispatch, and the agent test's own trace write. */
  httpProxy: HttpProxyTrpcPorts;
  /** The usage reading and the approaching-limit notifier, over the billing store. */
  limits: LimitsTrpcPorts;
}

/**
 * The group's ports with every parameter widened, for a host that publishes no
 * client type.
 *
 * The parameters exist so a CLIENT sees the concrete shapes the ports answer
 * with — the grid's own filter input, the saved view's own row. A composition
 * root hands the record on as a `TRPCRouterRecord` and derives nothing, so it
 * states this alias instead of restating twelve parameters.
 */
export type AnyAppTraceGroupTrpcPorts = AppTraceGroupTrpcPorts<
  TraceLegacyListInput,
  unknown,
  TraceLegacyFilterInput,
  unknown,
  unknown,
  TraceEditOverlayVisibilityWindow,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>;

/**
 * Builds all sixteen surfaces against one process's mount.
 *
 * The result is keyed by the namespace each answers on, so the caller spreads
 * it into the record and adds nothing per feature. Generic in the whole ports
 * object rather than in its twelve members: every factory below infers its own
 * parameters from the slice it is handed, so the concrete shapes a process
 * wired in survive into the record's inferred type instead of collapsing to
 * the widened alias above.
 */
export function createAppTraceGroupTrpcFeatures<
  TContext extends AppTraceGroupTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends AnyAppTraceGroupTrpcPorts,
>(options: {
  mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPublicMount<TContext, TOptions, TRoot>;
  ports: TPorts;
}) {
  const { mount, ports } = options;

  return {
    costs: createCostTrpcRouter({ ...mount, ports: ports.costs }),
    httpProxy: createHttpProxyTrpcRouter({ ...mount, ports: ports.httpProxy }),
    limits: createLimitsTrpcRouter({ ...mount, ports: ports.limits }),
    llmModelCost: createLlmModelCostTrpcRouter({ ...mount, ports: ports.llmModelCost }),
    modelProvider: createModelProviderTrpcRouter({
      ...mount,
      ports: ports.modelProvider,
      checks: ports.modelProviderChecks,
    }),
    // Both share surfaces take no ports: a link and a pin are rows this
    // deployment owns outright, reached through `ctx.app.share`.
    pinnedTrace: createPinnedTraceTrpcRouter(mount),
    // What this organization is on. No ports either — the plan is resolved off
    // the application slice, because ONE answer to "which plan" is the whole
    // point of a plan provider.
    plan: createPlanTrpcRouter(mount),
    savedViews: createSavedViewTrpcRouter({ ...mount, ports: ports.savedViews }),
    share: createShareTrpcRouter(mount),
    // ADR-057's single anonymous trace read. It takes the process's PUBLIC
    // procedure and a `noPermission` declaration rather than a permission: the
    // share token in the input is the whole authorization, and the declaration
    // is what keeps the procedure reviewable rather than merely unchecked.
    sharedTrace: createSharedTraceTrpcRouter({
      ...mount,
      publicProcedure: mount.publicProcedure,
      ports: ports.sharedTrace,
    }),
    spans: createSpansTrpcRouter({ ...mount, ports: ports.spans }),
    topics: createTopicTrpcRouter(mount),
    traceEditOverlay: createTraceEditOverlayTrpcRouter({
      ...mount,
      ports: ports.traceEditOverlay,
    }),
    // Carries `onTraceUpdate`. In the record rather than beside it: see the
    // module docblock.
    traces: createTracesTrpcRouter({ ...mount, ports: ports.traces }),
    // Carries `onDiscoverUpdate`, for the same reason.
    tracesV2: createTracesV2TrpcRouter({ ...mount, ports: ports.tracesV2 }),
    translate: createTranslateTrpcRouter({ ...mount, ports: ports.translate }),
  };
}
