/**
 * The project's traces over the process's tRPC transport.
 *
 *   getAllForProject / getAllForDownload: the list and search grid, and the
 *                        same read taken as a download. The grid stays on the
 *                        stored preview; the download resolves offloaded
 *                        values in full.
 *   getById / getTracesWithSpans / getTracesByThreadId /
 *   getTracesWithSpansByThreadIds: one trace, several traces, one
 *                        conversation, several conversations — every one of
 *                        them a content read, so every one resolves in full.
 *   getEvaluations / getEvaluationsMultiple / getEvaluationInputs: the
 *                        evaluator verdicts on a trace or a page of them, and
 *                        one verdict's inputs fetched lazily when its card is
 *                        opened.
 *   getTopicCounts / getCustomersAndLabels / getFieldNames: what the topic,
 *                        customer, label and field-mapping pickers offer.
 *   getFormattedSpansDigest: the whole trace rendered as one readable digest.
 *   getSampleTraces / getSampleTracesDataset: the samples an evaluator wizard
 *                        and the dataset builder start from.
 *   onTraceUpdate:       the server-sent stream that tells an open grid its
 *                        project has new traces.
 *
 * Every procedure takes `traces:view`.
 *
 * Transport only: policy, input parsing and delegation to `TraceApp`. Which
 * reads resolve offloaded values in full and which stay on the stored preview
 * (#4991) is the application's decision, not this door's, so the same rule
 * answers the explorer, the share page and the REST surface. Anonymous shared
 * reads are NOT here — they go through the dedicated `sharedTrace.get`
 * surface, the single public trace read ADR-057 allows.
 */
import { on } from "node:events";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type {
  Span,
  Trace,
  TraceLegacyFilterInput,
  TraceLegacyListInput,
} from "@langwatch/trace-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { TraceApp } from "#app/trace.app";

const logger = createLogger("langwatch:traces:sse-subscription");

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type TracesTrpcContext = Readonly<{ app: Readonly<{ traces: TraceApp }> }>;

type TracesTrpcProcedures<
  TContext extends TracesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The process capabilities this transport needs that Trace does not own.
 *
 * The two filter schemas are injected rather than declared here because the
 * same shapes are the REST search body and the analytics read input: one
 * definition, in the process, is what keeps those surfaces from drifting while
 * the filter vertical is still application-owned. The precondition trio is the
 * evaluator wizard's rule engine, which belongs to Evaluation rather than to
 * Trace.
 */
export type TracesTrpcPorts<
  TListInput extends TraceLegacyListInput,
  TListInputRaw,
  TFilterInput extends TraceLegacyFilterInput,
  TFilterInputRaw,
  TPrecondition,
> = Readonly<{
  /**
   * Project, period, query and filters — everything a read is scoped by.
   *
   * Both the parsed shape and the shape a caller SENDS are carried, because
   * they differ (`filters` defaults, so it is optional on the wire and present
   * after parsing) and tRPC types the client off the sent shape. Naming only
   * the parsed one would leave every caller of these reads unchecked.
   */
  filterInputSchema: z.ZodType<TFilterInput, TFilterInputRaw>;
  /** The same, plus paging and ordering for the list/search read. */
  listInputSchema: z.ZodType<TListInput, TListInputRaw>;
  /** Which evaluators this deployment offers, built-in and custom. */
  evaluatorTypeSchema: z.ZodType<string, string>;
  /** One configured precondition rule on the evaluator wizard's sample step. */
  preconditionSchema: z.ZodType<TPrecondition>;
  /**
   * The caller's read-time redactions for one project: cost visibility, the
   * data-privacy policy's content categories, the restricted-attribute rules
   * and the plan's visibility cutoff. Resolved per request because they depend
   * on the session, and passed straight through to the read.
   */
  getViewerProtections(ctx: unknown, input: Readonly<{ projectId: string }>): Promise<unknown>;
  /** A whole trace's spans rendered as the one readable digest a judge reads. */
  formatSpansDigest(spans: Span[]): Promise<string>;
  /** Whether the evaluator's own required fields are present on this trace. */
  checkEvaluatorRequiredFields(
    input: Readonly<{
      evaluatorType: string;
      spans: Span[];
      expectedOutput?: { value: string } | null;
    }>,
  ): boolean;
  /**
   * The trace, reduced to the facts a precondition rule reads. Opaque here —
   * this transport only carries it from one port to the next.
   */
  buildPreconditionTraceData(input: Readonly<{ trace: Trace; spans: Span[] }>): unknown;
  /** Whether every configured precondition holds for that trace. */
  evaluatePreconditions(
    input: Readonly<{ traceData: unknown; preconditions: TPrecondition[] }>,
  ): boolean;
}>;

/**
 * Opt-in for reviewer corrections. Default false so every existing consumer
 * (evaluations, exports, automations, the REST surface) keeps reading exactly
 * what was ingested; only the add-to-dataset flow asks for the corrected trace.
 */
const withEditOverlayInput = z.boolean().default(false);

const traceScopeSchema = z.object({ projectId: z.string(), traceId: z.string() });

/**
 * A uniformly random permutation, in a copy. The sample steps draw from an
 * unordered page of traces, so a stable order would hand every wizard run the
 * same first ten rows.
 */
function shuffled<T>(values: readonly T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const pick = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[pick]] = [copy[pick]!, copy[index]!];
  }
  return copy;
}

/** Installs the complete `traces.*` tRPC surface on a process-owned root. */
export class TracesTrpcApi {
  static create<
    TContext extends TracesTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TListInput extends TraceLegacyListInput,
    TListInputRaw,
    TFilterInput extends TraceLegacyFilterInput,
    TFilterInputRaw,
    TPrecondition,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: TracesTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TracesTrpcPorts<TListInput, TListInputRaw, TFilterInput, TFilterInputRaw, TPrecondition>,
  ) {
    const { protected: procedure, policy } = procedures;

    // Chained rather than intersected. `.input()` twice leaves BOTH parsers on
    // the procedure, each still an object the router sweep can read its scope
    // fields out of; one `z.intersection` would leave a single schema with no
    // readable shape, and the sweep reports an input it cannot inspect rather
    // than trusting it. The keys added here are exactly the ones the process's
    // filter schema does not already carry — `projectId` and `query` were
    // re-declared identically by the router this replaced, which added nothing
    // and would now collide on merge.
    const sampleExtrasSchema = z.object({ sortBy: z.string().optional() });

    const sampleTracesExtrasSchema = z.object({
      sortBy: z.string().optional(),
      evaluatorType: ports.evaluatorTypeSchema,
      preconditions: z.array(ports.preconditionSchema),
      expectedResults: z.number(),
    });

    const downloadExtrasSchema = z.object({ includeSpans: z.boolean() });

    return trpc.router({
      getAllForProject: policy("traces:view")(procedure.input(ports.listInputSchema)).query(
        async ({ ctx, input }) => {
          const protections = await ports.getViewerProtections(ctx, {
            projectId: input.projectId,
          });

          return ctx.app.traces.listTraces({
            query: input,
            protections,
            options: { scrollId: input.scrollId },
          });
        },
      ),

      getById: policy("traces:view")(
        procedure.input(traceScopeSchema.extend({ withEditOverlay: withEditOverlayInput })),
      ).query(async ({ ctx, input }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });

        const trace = await ctx.app.traces.readTrace({
          projectId: input.projectId,
          traceId: input.traceId,
          protections,
          withEditOverlay: input.withEditOverlay,
        });

        if (!trace) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found." });
        }

        return trace;
      }),

      getEvaluations: policy("traces:view")(procedure.input(traceScopeSchema)).query(
        async ({ input, ctx }) => {
          const protections = await ports.getViewerProtections(ctx, {
            projectId: input.projectId,
          });

          const evaluations = await ctx.app.traces.readEvaluations({
            projectId: input.projectId,
            traceIds: [input.traceId],
            protections,
          });

          return evaluations[input.traceId];
        },
      ),

      // Protected (not public-share): the read is keyed by evaluationId, which
      // is only tenant-scoped, so authorization must be the whole project too.
      // A public-share token is scoped to a single trace and could otherwise be
      // used to read any evaluation's inputs in the project by supplying
      // another evaluationId. Public-shared trace drawers already get inputs
      // eagerly from the public `getEvaluations`; this lazy fallback stays
      // project-gated.
      getEvaluationInputs: policy("traces:view")(
        procedure.input(z.object({ projectId: z.string(), evaluationId: z.string() })),
      ).query(async ({ input, ctx }) => {
        return ctx.app.traces.readEvaluationInputs({
          projectId: input.projectId,
          evaluationId: input.evaluationId,
        });
      }),

      getEvaluationsMultiple: policy("traces:view")(
        procedure.input(z.object({ projectId: z.string(), traceIds: z.array(z.string()) })),
      ).query(async ({ input, ctx }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });

        return ctx.app.traces.readEvaluations({
          projectId: input.projectId,
          traceIds: input.traceIds,
          protections,
        });
      }),

      getTopicCounts: policy("traces:view")(procedure.input(ports.filterInputSchema)).query(
        async ({ input, ctx }) => {
          const result = await ctx.app.traces.readTopicCounts(input);

          const topicsMap = Object.fromEntries(
            (await ctx.app.traces.readTopics({ projectId: input.projectId })).map((topic) => [
              topic.id,
              topic,
            ]),
          );

          const mapBuckets = (
            buckets: Array<{ key: string; count: number }>,
            includeParent = false,
          ) => {
            return buckets.reduce(
              (acc, bucket) => {
                const topic = topicsMap[bucket.key];
                if (!topic) return acc;

                return [
                  ...acc,
                  {
                    id: bucket.key,
                    name: topic.name,
                    count: bucket.count,
                    ...(includeParent && { parentId: topic.parentId }),
                  },
                ];
              },
              [] as {
                id: string;
                name: string;
                count: number;
                parentId?: string | null;
              }[],
            );
          };

          const topicCounts = mapBuckets(result.topicCounts);
          const subtopicCounts = mapBuckets(result.subtopicCounts, true);

          return { topicCounts, subtopicCounts };
        },
      ),

      getCustomersAndLabels: policy("traces:view")(procedure.input(ports.filterInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.traces.readCustomersAndLabels(input);
        },
      ),

      getTracesByThreadId: policy("traces:view")(
        procedure.input(z.object({ projectId: z.string(), threadId: z.string() })),
      ).query(async ({ input, ctx }) => {
        const { projectId, threadId } = input;

        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });

        // Thread-detail read consumes conversation content, so the application
        // resolves full IO (#4991) rather than the 64 KB preview. Anonymous
        // shared reads go through the dedicated `sharedTrace.get` surface,
        // never this endpoint. See ADR-057.
        return ctx.app.traces.readThreadTraces({ projectId, threadId, protections });
      }),

      getTracesWithSpans: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceIds: z.array(z.string()),
            withEditOverlay: withEditOverlayInput,
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const { projectId, traceIds } = input;
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });

        return ctx.app.traces.readTracesWithSpans({
          projectId,
          traceIds,
          protections,
          withEditOverlay: input.withEditOverlay,
        });
      }),

      getFormattedSpansDigest: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            traceIds: z.array(z.string()),
            withEditOverlay: withEditOverlayInput,
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const { projectId, traceIds } = input;
        const protections = await ports.getViewerProtections(ctx, { projectId });

        // The digest is one more reading of the same spans the other columns
        // are mapped from, so the correction is read the same way. Read without
        // it, the one column that quotes the whole trace would spell out the
        // very spans the reviewer deleted.
        //
        // It stays on previews all the same: this runs over a whole page of
        // traces at once, and resolving every offloaded value on all of them is
        // what #4991 kept off the grid. Applying a correction needs none of it.
        const traces = await ctx.app.traces.readTracesWithSpansPreview({
          projectId,
          traceIds,
          protections,
          withEditOverlay: input.withEditOverlay,
        });

        return Object.fromEntries(
          await Promise.all(
            traces.map(async (t) => [t.trace_id, await ports.formatSpansDigest(t.spans ?? [])]),
          ),
        );
      }),

      getTracesWithSpansByThreadIds: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            threadIds: z.array(z.string()),
            withEditOverlay: withEditOverlayInput,
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const { projectId, threadIds } = input;
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });

        // Thread reads consume conversation content, so the application
        // resolves full IO (#4991).
        return ctx.app.traces.readThreadsTraces({
          projectId,
          threadIds,
          protections,
          withEditOverlay: input.withEditOverlay,
        });
      }),

      // One `.input()` over an intersection rather than two chained calls.
      // tRPC's second `.input()` merges through a conditional on the input it
      // already has, and the process supplies these schemas as type
      // parameters — an unresolved parameter never takes the merging branch,
      // so the chain resolved to the framework's `TypeError<…>`. The parsed
      // shape and the published input are the same either way.
      getSampleTracesDataset: policy("traces:view")(
        procedure.input(z.intersection(ports.filterInputSchema, sampleExtrasSchema)),
      ).query(async ({ ctx, input }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });

        // Dataset builder persists trace content, so the application resolves
        // full IO (#4991) and truncated rows never corrupt the dataset. The
        // ID-only list read it draws from stays on the preview.
        return ctx.app.traces.readSampleTraces({ query: input, protections, pageSize: 10 });
      }),

      getFieldNames: policy("traces:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            startDate: z.number(),
            endDate: z.number(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        return ctx.app.traces.readFieldNames({
          projectId: input.projectId,
          startDate: input.startDate,
          endDate: input.endDate,
        });
      }),

      getSampleTraces: policy("traces:view")(
        procedure.input(z.intersection(ports.filterInputSchema, sampleTracesExtrasSchema)),
      ).query(async ({ ctx, input }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });

        // Sample builder feeds dataset/evaluator content, so the application
        // resolves full IO (#4991). The ID-only list read it draws from stays
        // on the preview.
        const traceWithSpans = await ctx.app.traces.readSampleTraces({
          query: input,
          protections,
          pageSize: 100,
        });

        const { evaluatorType, preconditions, expectedResults } = input;

        const passedPreconditions = traceWithSpans.filter((trace) => {
          if (!evaluatorType) return false;
          const spans = trace.spans ?? [];
          const requiredFieldsMet = ports.checkEvaluatorRequiredFields({
            evaluatorType,
            spans,
            expectedOutput: trace.expected_output,
          });
          if (!requiredFieldsMet) return false;
          const traceData = ports.buildPreconditionTraceData({ trace, spans });
          return ports.evaluatePreconditions({ traceData, preconditions });
        });
        const passedPreconditionsTraceIds = passedPreconditions?.map((trace) => trace.trace_id);

        let samples = shuffled(passedPreconditions)
          .slice(0, expectedResults)
          .map((sample) => ({ ...sample, passesPreconditions: true }));
        if (samples.length < 10) {
          samples = samples.concat(
            shuffled(
              traceWithSpans.filter(
                (trace) => !passedPreconditionsTraceIds?.includes(trace.trace_id),
              ),
            )
              .slice(0, expectedResults - samples.length)
              .map((sample) => ({ ...sample, passesPreconditions: false })),
          );
        }

        return samples;
      }),

      getAllForDownload: policy("traces:view")(
        procedure.input(z.intersection(ports.listInputSchema, downloadExtrasSchema)),
      ).mutation(async ({ ctx, input }) => {
        const protections = await ports.getViewerProtections(ctx, {
          projectId: input.projectId,
        });

        // A download consumes trace content, so it must never serve the 64 KB
        // preview (#4991 AC1) — and that holds whether or not spans are
        // included, because the returned traces carry trace-level
        // `input`/`output` either way. Gating resolveBlobs on includeSpans (as
        // this did) silently truncated any offloaded trace in a spans-less
        // download, the same data-loss bug fixed in ExportService for
        // summary-mode exports.
        return ctx.app.traces.listTraces({
          query: { ...input, pageSize: input.pageSize ?? 10_000 },
          protections,
          options: {
            downloadMode: true,
            includeSpans: input.includeSpans,
            resolveBlobs: true,
            scrollId: input.scrollId,
          },
        });
      }),

      onTraceUpdate: policy("traces:view")(
        procedure.input(z.object({ projectId: z.string() })),
      ).subscription(async function* (opts) {
        const { projectId } = opts.input;
        const emitter = opts.ctx.app.traces.getTenantEmitter(projectId);

        logger.info({ projectId }, "SSE subscription started");

        try {
          for await (const eventArgs of on(emitter, "trace_updated", {
            signal: opts.signal,
          })) {
            logger.debug({ projectId, event: eventArgs[0] }, "SSE event received");
            yield eventArgs[0];
          }
          logger.info({ projectId }, "SSE subscription ended normally");
        } finally {
          logger.debug({ projectId }, "SSE subscription cleanup");
          opts.ctx.app.traces.cleanupTenantEmitter(projectId);
        }
      }),
    });
  }
}
