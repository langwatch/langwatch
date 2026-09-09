/**
 * The project's traces over the process's tRPC transport. Every procedure takes `traces:view`.
 * Transport only: policy, input parsing and delegation to `TraceApp`. Which reads resolve
 * offloaded values in full and which stay on the stored preview is the application's decision,
 * not this door's. Anonymous shared reads are NOT here — see `sharedTrace.get` (ADR-057).
 */
import { on } from "node:events";
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  customersAndLabelsResultSchema,
  distinctFieldNamesResultSchema,
  evaluationSchema,
  namedTopicCountsSchema,
  sampledTraceSchema,
  traceSchema,
  tracesForProjectResultSchema,
  type Span,
  type Trace,
  type TraceLegacyFilterInput,
  type TraceLegacyListInput,
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
   * Applied AFTER this feature's own input parser: the authorization check reads its scope id
   * from the validated input, and tRPC runs middlewares in the order they were added.
   */
  policy(access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/**
 * The process capabilities this transport needs that Trace does not own. The two filter
 * schemas are injected rather than declared here since the same shapes are the REST search body
 * and the analytics read input. The precondition trio belongs to Evaluation, not Trace.
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

    // Intersected onto the process's filter parser, not chained with a second `.input()`: tRPC
    // types a chained `.input()` as conditional on the already-accumulated input, and the base
    // parser arrives here as a type parameter, so that conditional never takes the merging
    // branch. The keys added here are exactly the ones the process's filter schema lacks.
    const sampleExtrasSchema = z.object({ sortBy: z.string().optional() });

    const sampleTracesExtrasSchema = z.object({
      sortBy: z.string().optional(),
      evaluatorType: ports.evaluatorTypeSchema,
      preconditions: z.array(ports.preconditionSchema),
      expectedResults: z.number(),
    });

    const downloadExtrasSchema = z.object({ includeSpans: z.boolean() });

    return (
      createTrpcService({
        root: trpc,
        procedures: { protected: procedure, policy },
        validateOutput: procedures.validateOutput,
      })
        .query("getAllForProject", (p) =>
          p
            .withInput(ports.listInputSchema)
            .withOutput(tracesForProjectResultSchema)
            .withPermission("traces:view")
            .handle(async ({ ctx, input }) => {
              const protections = await ports.getViewerProtections(ctx, {
                projectId: input.projectId,
              });

              return ctx.app.traces.listTraces({
                query: input,
                protections,
                options: { scrollId: input.scrollId },
              });
            }),
        )
        .query("getById", (p) =>
          p
            .withInput(traceScopeSchema.extend({ withEditOverlay: withEditOverlayInput }))
            .withOutput(traceSchema)
            .withPermission("traces:view")
            .handle(async ({ ctx, input }) => {
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
        )
        .query("getEvaluations", (p) =>
          p
            .withInput(traceScopeSchema)
            .withOutput(evaluationSchema.array().optional())
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) => {
              const protections = await ports.getViewerProtections(ctx, {
                projectId: input.projectId,
              });

              const evaluations = await ctx.app.traces.readEvaluations({
                projectId: input.projectId,
                traceIds: [input.traceId],
                protections,
              });

              return evaluations[input.traceId];
            }),
        )

        // Protected (not public-share): the read is keyed by evaluationId, which
        // is only tenant-scoped, so authorization must be the whole project too.
        // A public-share token is scoped to a single trace and could otherwise be
        // used to read any evaluation's inputs in the project by supplying
        // another evaluationId. Public-shared trace drawers already get inputs
        // eagerly from the public `getEvaluations`; this lazy fallback stays
        // project-gated.
        .query("getEvaluationInputs", (p) =>
          p
            .withInput(z.object({ projectId: z.string(), evaluationId: z.string() }))
            .withOutput(z.record(z.string(), z.unknown()).nullable())
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) => {
              return ctx.app.traces.readEvaluationInputs({
                projectId: input.projectId,
                evaluationId: input.evaluationId,
              });
            }),
        )
        .query("getEvaluationsMultiple", (p) =>
          p
            .withInput(z.object({ projectId: z.string(), traceIds: z.array(z.string()) }))
            .withOutput(z.record(z.string(), evaluationSchema.array()))
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) => {
              const protections = await ports.getViewerProtections(ctx, {
                projectId: input.projectId,
              });

              return ctx.app.traces.readEvaluations({
                projectId: input.projectId,
                traceIds: input.traceIds,
                protections,
              });
            }),
        )
        .query("getTopicCounts", (p) =>
          p
            .withInput(ports.filterInputSchema)
            .withOutput(namedTopicCountsSchema)
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) => {
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
            }),
        )
        .query("getCustomersAndLabels", (p) =>
          p
            .withInput(ports.filterInputSchema)
            .withOutput(customersAndLabelsResultSchema)
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) => {
              return ctx.app.traces.readCustomersAndLabels(input);
            }),
        )
        .query("getTracesByThreadId", (p) =>
          p
            .withInput(z.object({ projectId: z.string(), threadId: z.string() }))
            .withOutput(traceSchema.array())
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) => {
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
        )
        .query("getTracesWithSpans", (p) =>
          p
            .withInput(
              z.object({
                projectId: z.string(),
                traceIds: z.array(z.string()),
                withEditOverlay: withEditOverlayInput,
              }),
            )
            .withOutput(traceSchema.array())
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) => {
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
        )
        .query("getFormattedSpansDigest", (p) =>
          p
            .withInput(
              z.object({
                projectId: z.string(),
                traceIds: z.array(z.string()),
                withEditOverlay: withEditOverlayInput,
              }),
            )
            .withOutput(z.record(z.string(), z.string()))
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) => {
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

              // `as const` is what keeps the answer a `Record<string, string>`: the
              // `await` between the map and `Object.fromEntries` breaks the
              // contextual typing that would infer the entry as a two-tuple, so
              // untupled this lands on the `Iterable<readonly any[]>: any` overload
              // and erases the procedure's output.
              return Object.fromEntries(
                await Promise.all(
                  traces.map(
                    async (t) =>
                      [t.trace_id, await ports.formatSpansDigest(t.spans ?? [])] as const,
                  ),
                ),
              );
            }),
        )
        .query("getTracesWithSpansByThreadIds", (p) =>
          p
            .withInput(
              z.object({
                projectId: z.string(),
                threadIds: z.array(z.string()),
                withEditOverlay: withEditOverlayInput,
              }),
            )
            .withOutput(traceSchema.array())
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) => {
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
        )

        // One `.input()` over an intersection rather than two chained calls.
        // tRPC's second `.input()` merges through a conditional on the input it
        // already has, and the process supplies these schemas as type
        // parameters — an unresolved parameter never takes the merging branch,
        // so the chain resolved to the framework's `TypeError<…>`. The parsed
        // shape and the published input are the same either way.
        .query("getSampleTracesDataset", (p) =>
          p
            .withInput(z.intersection(ports.filterInputSchema, sampleExtrasSchema))
            .withOutput(traceSchema.array())
            .withPermission("traces:view")
            .handle(async ({ ctx, input }) => {
              const protections = await ports.getViewerProtections(ctx, {
                projectId: input.projectId,
              });

              // Dataset builder persists trace content, so the application resolves
              // full IO (#4991) and truncated rows never corrupt the dataset. The
              // ID-only list read it draws from stays on the preview.
              return ctx.app.traces.readSampleTraces({
                query: input,
                protections,
                pageSize: 10,
              });
            }),
        )
        .query("getFieldNames", (p) =>
          p
            .withInput(
              z.object({
                projectId: z.string(),
                startDate: z.number(),
                endDate: z.number(),
              }),
            )
            .withOutput(distinctFieldNamesResultSchema)
            .withPermission("traces:view")
            .handle(async ({ ctx, input }) => {
              return ctx.app.traces.readFieldNames({
                projectId: input.projectId,
                startDate: input.startDate,
                endDate: input.endDate,
              });
            }),
        )
        .query("getSampleTraces", (p) =>
          p
            .withInput(z.intersection(ports.filterInputSchema, sampleTracesExtrasSchema))
            .withOutput(sampledTraceSchema.array())
            .withPermission("traces:view")
            .handle(async ({ ctx, input }) => {
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
              const passedPreconditionsTraceIds = passedPreconditions?.map(
                (trace) => trace.trace_id,
              );

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
        )
        .mutation("getAllForDownload", (p) =>
          p
            .withInput(z.intersection(ports.listInputSchema, downloadExtrasSchema))
            .withOutput(tracesForProjectResultSchema)
            .withPermission("traces:view")
            .handle(async ({ ctx, input }) => {
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
        )
        .subscription("onTraceUpdate", (p) =>
          p
            .withInput(z.object({ projectId: z.string() }))
            .withoutOutput(
              "the stream carries the process's own trace_updated broadcast payload verbatim, which this feature does not shape",
            )
            .withPermission("traces:view")
            .handle(async function* (opts) {
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
        )
        .build()
    );
  }
}
