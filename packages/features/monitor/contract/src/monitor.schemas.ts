/**
 * The inputs the `monitors.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 *
 * `create` and `update` are factories rather than constants because the
 * preconditions they accept are parsed by a schema the process injects — the
 * one the evaluation surface already validates against. Taking it as a
 * parameter keeps that single definition and still lets the surrounding shape
 * live here.
 */
import { z } from "zod";
import { monitorExecutionModeSchema, type MonitorCreateInput } from "./monitor";

/** The process's own precondition parser, injected into the two write inputs. */
export type MonitorApiPreconditionsParser = z.ZodType<
  MonitorCreateInput["preconditions"],
  MonitorCreateInput["preconditions"]
>;

/** One project. Every project-scoped procedure on the surface takes it. */
export const monitorApiProjectInputSchema = z.object({ projectId: z.string() });

/** One monitor inside one project. */
export const monitorApiMonitorInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
});

export const monitorApiPerformanceInputSchema = z.object({
  projectId: z.string(),
  timeZone: z.string().min(1).max(100).optional(),
});

export const monitorApiToggleInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  enabled: z.boolean(),
});

export const monitorApiCopyInputSchema = z.object({
  monitorId: z.string(),
  // Target project to replicate into.
  projectId: z.string(),
  // Project the monitor is being copied from.
  sourceProjectId: z.string(),
});

export const monitorApiNameAvailabilityInputSchema = z.object({
  projectId: z.string(),
  checkId: z.string().optional(),
  name: z.string(),
});

/**
 * The field-mapping blob a monitor carries. Open on purpose: its shape is the
 * evaluator's, which this surface does not know.
 */
export const monitorApiMappingsSchema = z.object({}).passthrough();

/** Creating a monitor. `preconditions` is the process's precondition parser. */
export function monitorApiCreateInputSchema(preconditions: MonitorApiPreconditionsParser) {
  return z.object({
    projectId: z.string(),
    name: z.string(),
    checkType: z.string(),
    preconditions,
    settings: z.record(z.string(), z.json()),
    mappings: monitorApiMappingsSchema.optional(),
    sample: z.number().min(0).max(1),
    executionMode: monitorExecutionModeSchema,
    evaluatorId: z.string().min(1).optional(),
    level: z.enum(["trace", "thread"]).optional(), // Evaluation level: trace or thread
    threadIdleTimeout: z.number().int().positive().nullable().optional(), // Seconds to wait after last message before evaluating thread
  });
}

/** Editing a monitor. `preconditions` is the process's precondition parser. */
export function monitorApiUpdateInputSchema(preconditions: MonitorApiPreconditionsParser) {
  return z.object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    checkType: z.string(),
    preconditions,
    settings: z.record(z.string(), z.json()),
    mappings: monitorApiMappingsSchema,
    sample: z.number().min(0).max(1),
    enabled: z.boolean().optional(),
    executionMode: monitorExecutionModeSchema,
    evaluatorId: z.string().min(1).nullable().optional(),
    level: z.enum(["trace", "thread"]).optional(), // Evaluation level: trace or thread
    threadIdleTimeout: z.number().int().positive().nullable().optional(), // Seconds to wait after last message before evaluating thread
  });
}

export type MonitorApiProjectInput = z.infer<typeof monitorApiProjectInputSchema>;
export type MonitorApiMonitorInput = z.infer<typeof monitorApiMonitorInputSchema>;
export type MonitorApiPerformanceInput = z.infer<typeof monitorApiPerformanceInputSchema>;
export type MonitorApiToggleInput = z.infer<typeof monitorApiToggleInputSchema>;
export type MonitorApiCopyInput = z.infer<typeof monitorApiCopyInputSchema>;
export type MonitorApiNameAvailabilityInput = z.infer<typeof monitorApiNameAvailabilityInputSchema>;
