/**
 * A trace's spans over the process's tRPC transport.
 *
 *   getAllForTrace:     every span on one trace, ordered the way a waterfall
 *                       reads: earliest start first, and where two spans start
 *                       together the longer one first, so a parent is never
 *                       drawn under the child it contains.
 *   getForPromptStudio: one LLM span reshaped into the messages and model
 *                       parameters the prompt studio opens with.
 *
 * Both take `traces:view` — a span is trace content, and nothing here is
 * readable to a caller who may not read the trace it belongs to.
 *
 * Transport only: policy, input parsing and delegation to the legacy trace
 * read. The viewer's redactions are resolved by the process (they depend on
 * the request's session, the project's data-privacy policy and the plan's
 * visibility window) and handed to the read unchanged.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { TraceLegacyReadPort } from "../../ports/trace-legacy-read.port";

type SpansApplication = Readonly<{
  traces: Readonly<{ read: TraceLegacyReadPort }>;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type SpansTrpcContext = Readonly<{ app: SpansApplication }>;

type SpansTrpcProcedures<
  TContext extends SpansTrpcContext,
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

/** The process capabilities this transport needs that Trace does not own. */
export type SpansTrpcPorts = Readonly<{
  /**
   * The caller's read-time redactions for one project: cost visibility, the
   * data-privacy policy's content categories, the restricted-attribute rules
   * and the plan's visibility cutoff. Resolved per request because they depend
   * on the session, and passed straight through to the read.
   */
  getViewerProtections(ctx: unknown, input: Readonly<{ projectId: string }>): Promise<unknown>;
}>;

const traceScopeSchema = z.object({ projectId: z.string(), traceId: z.string() });
const spanScopeSchema = z.object({ projectId: z.string(), spanId: z.string() });

/** Installs the complete `spans.*` tRPC surface on a process-owned root. */
export class SpansTrpcApi {
  static create<
    TContext extends SpansTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SpansTrpcProcedures<TContext, TOptions, TRoot>,
    ports: SpansTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getAllForTrace: policy("traces:view")(procedure.input(traceScopeSchema)).query(
        async ({ ctx, input }) => {
          const protections = await ports.getViewerProtections(ctx, {
            projectId: input.projectId,
          });

          const traceService = ctx.app.traces.read;
          const traces = await traceService.getTracesWithSpans(
            input.projectId,
            [input.traceId],
            protections,
            undefined,
            { full: true },
          );
          if (traces.length === 0) {
            return [];
          }

          const trace = traces.find((t) => t.trace_id === input.traceId);
          if (!trace) {
            return [];
          }
          if (!trace.spans) {
            return [];
          }

          const sortedSpans = trace.spans.sort((a, b) => {
            const aStart = a.timestamps?.started_at ?? 0;
            const bStart = b.timestamps?.started_at ?? 0;

            const startDiff = aStart - bStart;
            if (startDiff === 0) {
              const aEnd = a.timestamps?.finished_at ?? 0;
              const bEnd = b.timestamps?.finished_at ?? 0;
              return bEnd - aEnd;
            }

            return startDiff;
          });

          return sortedSpans;
        },
      ),

      getForPromptStudio: policy("traces:view")(procedure.input(spanScopeSchema)).query(
        async ({ ctx, input }) => {
          const { projectId, spanId } = input;

          const protections = await ports.getViewerProtections(ctx, { projectId });

          const traceService = ctx.app.traces.read;
          const result = await traceService.getSpanForPromptStudio(projectId, spanId, protections);

          if (!result) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Span not found or is not an LLM span.",
            });
          }

          return result;
        },
      ),
    });
  }
}
