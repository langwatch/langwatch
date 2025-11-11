import {
  context as otelContext,
  type Span,
  propagation,
  trace,
} from "@opentelemetry/api";
import { useOtel } from "./useOtel";

type TraceContextOptions = {
  trpc?: {
    context?: Record<string, unknown>;
  };
};

function mergeTraceContext(
  options: TraceContextOptions | undefined,
  traceHeaders: Record<string, string>,
): TraceContextOptions {
  return {
    ...(options ?? {}),
    trpc: {
      ...(options?.trpc ?? {}),
      context: {
        ...(options?.trpc?.context ?? {}),
        traceHeaders,
      },
    },
  };
}

/**
 * Builds trace headers from a span for distributed tracing.
 * Single Responsibility: Extract W3C trace context headers from an OpenTelemetry span.
 *
 * @param span - The OpenTelemetry span to extract headers from
 * @returns Object containing trace headers (traceparent, baggage, etc.)
 */
export function buildTraceHeadersFromSpan(span: Span | null): Record<string, string> {
  if (!span) return {};

  const carrier: Record<string, string> = {};

  // Put this span into a context and inject W3C headers into `carrier`
  const ctx = trace.setSpan(otelContext.active(), span);
  propagation.inject(ctx, carrier);

  // carrier now contains `traceparent` and possibly `baggage`
  return carrier;
}

/**
 * Hook for tRPC queries with automatic OpenTelemetry trace propagation.
 * Single Responsibility: Wrap tRPC queries with automatic trace context injection.
 *
 * @param procedure - The tRPC query procedure (e.g., api.scenarios.getScenarioSetsData)
 * @param input - Input parameters for the query
 * @param options - Optional React Query options (trace context will be automatically merged)
 * @returns The full React Query result with trace propagation
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useTracedQuery(
 *   api.scenarios.getScenarioSetsData,
 *   { projectId: project?.id ?? "" },
 *   { refetchInterval: 4000, enabled: !!project }
 * );
 * ```
 */
export function useTracedQuery<
  TInput,
  TOptions,
  TOutput,
  TProcedure extends {
    useQuery: (input: TInput, options?: TOptions) => TOutput;
  }
>(
  procedure: TProcedure,
  input: TInput,
  options?: TOptions,
): TOutput {
  const { currentSpan } = useOtel();
  const traceHeaders = buildTraceHeadersFromSpan(currentSpan);
  const optionsWithTrace = mergeTraceContext(
    options as TraceContextOptions | undefined,
    traceHeaders,
  ) as TOptions;

  return procedure.useQuery(input, optionsWithTrace);
}

/**
 * Hook for tRPC mutations with automatic OpenTelemetry trace propagation.
 * Single Responsibility: Wrap tRPC mutations with automatic trace context injection.
 *
 * @param procedure - The tRPC mutation procedure (e.g., api.scenarios.createScenario)
 * @param options - Optional React Query mutation options (trace context will be automatically merged)
 * @returns The full React Query mutation result with trace propagation
 *
 * @example
 * ```tsx
 * const mutation = useTracedMutation(api.scenarios.createScenario, {
 *   onSuccess: (data) => {
 *     // Handle success
 *   }
 * });
 *
 * // Later...
 * mutation.mutate({ projectId: "123", name: "My Scenario" });
 * ```
 */
export function useTracedMutation<
  TOptions,
  TOutput,
  TProcedure extends {
    useMutation: (options?: TOptions) => TOutput;
  }
>(
  procedure: TProcedure,
  options?: TOptions,
): TOutput {
  const { currentSpan } = useOtel();
  const traceHeaders = buildTraceHeadersFromSpan(currentSpan);
  const optionsWithTrace = mergeTraceContext(
    options as TraceContextOptions | undefined,
    traceHeaders,
  ) as TOptions;

  return procedure.useMutation(optionsWithTrace);
}
