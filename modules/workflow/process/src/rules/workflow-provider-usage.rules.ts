/**
 * The token usage an engine run's LLM nodes report (`metrics`), as the gateway ledger entries
 * it becomes (ADR-193). The request id names the trace, workflow, node and model, so a repeat
 * is one ledger row. A malformed or absent block is no usage, never a failed run.
 */
import type { GatewayProviderUsage } from "@langwatch/gateway-contract";
import { z } from "zod";

const quantity = z.number().int().min(0).catch(0);

const nodeMetricsSchema = z.object({
  model: z.string().min(1),
  prompt_tokens: quantity.default(0),
  completion_tokens: quantity.default(0),
  reasoning_tokens: quantity.default(0),
  cache_read_input_tokens: quantity.default(0),
  cache_creation_input_tokens: quantity.default(0),
});

const timestampsSchema = z
  .object({ started_at: z.number().optional(), finished_at: z.number().optional() })
  .catch({});

const componentStateEventSchema = z.object({
  type: z.literal("component_state_change"),
  payload: z.object({
    component_id: z.string().min(1),
    execution_state: z.object({
      status: z.string(),
      trace_id: z.string().min(1),
      metrics: z.unknown(),
      timestamps: timestampsSchema.optional(),
    }),
  }),
});

const nodeUsageSchema = z.object({
  node_id: z.string().min(1),
  trace_id: z.string().min(1),
  metrics: z.unknown(),
  duration_ms: z.number().optional(),
});

const evaluationProgressEventSchema = z.object({
  type: z.literal("evaluation_state_change"),
  payload: z.object({ usage: z.array(z.unknown()).catch([]) }),
});

const syncResultSchema = z.object({
  trace_id: z.string().min(1),
  nodes: z
    .record(
      z.string(),
      z
        .object({ metrics: z.unknown(), duration_ms: z.number().optional() })
        .catch({ metrics: undefined }),
    )
    .catch({}),
});

/** The run each entry belongs to, and when it was seen. */
type WorkflowUsageScope = Readonly<{
  projectId: string;
  /** The graph's own id; a sub-workflow can share its parent's trace and node ids. */
  workflowId: string;
  occurredAt: number;
}>;

/** One LLM node's usage, from one studio stream event: a node's finished state or a row's. */
export function workflowUsagesOfStreamEvent({
  event,
  ...scope
}: WorkflowUsageScope & { event: unknown }): GatewayProviderUsage[] {
  const component = componentStateEventSchema.safeParse(event);
  if (component.success) {
    const { component_id, execution_state: state } = component.data.payload;
    if (state.status !== "success") return [];
    const { started_at, finished_at } = state.timestamps ?? {};
    return usageEntry({
      ...scope,
      traceId: state.trace_id,
      nodeId: component_id,
      metrics: state.metrics,
      durationMs:
        started_at !== undefined && finished_at !== undefined ? finished_at - started_at : 0,
    });
  }

  const progress = evaluationProgressEventSchema.safeParse(event);
  if (!progress.success) return [];
  return progress.data.payload.usage.flatMap((row) => {
    const parsed = nodeUsageSchema.safeParse(row);
    if (!parsed.success) return [];
    return usageEntry({
      ...scope,
      traceId: parsed.data.trace_id,
      nodeId: parsed.data.node_id,
      metrics: parsed.data.metrics,
      durationMs: parsed.data.duration_ms ?? 0,
    });
  });
}

/** Every LLM node's usage on one `execute_sync` answer. */
export function workflowUsagesOfSyncResult({
  result,
  ...scope
}: WorkflowUsageScope & { result: unknown }): GatewayProviderUsage[] {
  const parsed = syncResultSchema.safeParse(result);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.nodes).flatMap(([nodeId, node]) =>
    usageEntry({
      ...scope,
      traceId: parsed.data.trace_id,
      nodeId,
      metrics: node.metrics,
      durationMs: node.duration_ms ?? 0,
    }),
  );
}

/** The graph id a studio or sync event names, or "" where it names none. */
export function workflowIdOfEvent(event: unknown): string {
  const parsed = z
    .object({ payload: z.object({ workflow: z.object({ workflow_id: z.string() }) }) })
    .safeParse(event);
  return parsed.success ? parsed.data.payload.workflow.workflow_id : "";
}

/** The engine's prompt count includes its cache subsets; the ledger counts them apart. */
function usageEntry({
  projectId,
  workflowId,
  occurredAt,
  traceId,
  nodeId,
  metrics,
  durationMs,
}: WorkflowUsageScope & {
  traceId: string;
  nodeId: string;
  metrics: unknown;
  durationMs: number;
}): GatewayProviderUsage[] {
  const parsed = nodeMetricsSchema.safeParse(metrics);
  if (!parsed.success) return [];
  const { model, prompt_tokens, completion_tokens, ...rest } = parsed.data;
  const usage = {
    input_tokens: Math.max(
      0,
      prompt_tokens - rest.cache_read_input_tokens - rest.cache_creation_input_tokens,
    ),
    output_tokens: completion_tokens,
    ...rest,
  };
  if (Object.values(usage).every((value) => value === 0)) return [];
  return [
    {
      requestId: `workflow:${traceId}:${workflowId}:${nodeId}:${model}`,
      projectId,
      model,
      requestType: "workflow",
      usage,
      durationMs: Math.max(0, Math.round(durationMs)),
      occurredAt,
    },
  ];
}
