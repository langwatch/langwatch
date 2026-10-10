import { moduleApi, type Named } from "@langwatch/module";
import { z } from "zod";

/**
 * Every subsystem the platform-health surface probes, in the order a report
 * lists them. The names are the deployment's own vocabulary and are already
 * the path segments of the per-subsystem probes.
 */
export const PLATFORM_HEALTH_CHECK_NAMES = [
  "collector",
  "evaluations",
  "processor",
  "triggers",
  "workflows",
] as const;

export type PlatformHealthCheckName = (typeof PLATFORM_HEALTH_CHECK_NAMES)[number];

export const platformHealthCheckNameSchema = z.enum(PLATFORM_HEALTH_CHECK_NAMES);

/**
 * What one subsystem reported. `not_configured` is neither a pass nor a
 * failure: the deployment never named a target for that probe, so paging on it
 * would be paging on our own configuration rather than on the platform.
 */
export const platformHealthCheckStatusSchema = z.enum(["healthy", "unhealthy", "not_configured"]);

export type PlatformHealthCheckStatus = z.infer<typeof platformHealthCheckStatusSchema>;

/** The one word an external monitor alerts on. */
export const platformHealthStatusSchema = z.enum(["healthy", "degraded", "unhealthy"]);

export type PlatformHealthStatus = z.infer<typeof platformHealthStatusSchema>;

/**
 * `detail` is our own words for what broke. It never carries an upstream's
 * prose, a hostname, a variable name or a tenant identifier: the body goes to
 * whoever holds the monitoring key, and a health answer is not a log line.
 */
const platformHealthCheckSchemaDefinition = z.strictObject({
  name: platformHealthCheckNameSchema,
  status: platformHealthCheckStatusSchema,
  durationMs: z.number().int().nonnegative(),
  detail: z.string().optional(),
});
export interface PlatformHealthCheckSchema extends Named<
  typeof platformHealthCheckSchemaDefinition
> {}
export const platformHealthCheckSchema: PlatformHealthCheckSchema =
  platformHealthCheckSchemaDefinition;

export type PlatformHealthCheck = z.infer<typeof platformHealthCheckSchema>;

const platformHealthReportSchemaDefinition = z.strictObject({
  status: platformHealthStatusSchema,
  checkedAt: z.string(),
  checks: z.array(platformHealthCheckSchema),
});
export interface PlatformHealthReportSchema extends Named<
  typeof platformHealthReportSchemaDefinition
> {}
export const platformHealthReportSchema: PlatformHealthReportSchema =
  platformHealthReportSchemaDefinition;

export type PlatformHealthReport = z.infer<typeof platformHealthReportSchema>;

/** What a monitor may narrow a report to, where it asks for one subsystem. */
const platformHealthQuerySchemaDefinition = z.object({
  triggerId: z.string().optional(),
  workflowId: z.string().optional(),
});
export interface PlatformHealthQuerySchema extends Named<
  typeof platformHealthQuerySchemaDefinition
> {}
export const platformHealthQuerySchema: PlatformHealthQuerySchema =
  platformHealthQuerySchemaDefinition;

export type PlatformHealthQuery = z.infer<typeof platformHealthQuerySchema>;

/** The headers a project-keyed `/api/health/*` probe reads its caller's key from. */
const healthProbeHeadersSchemaDefinition = z.object({
  "x-auth-token": z.string().optional(),
  authorization: z.string().optional(),
  "x-project-id": z.string().optional(),
});
export interface HealthProbeHeadersSchema extends Named<
  typeof healthProbeHeadersSchemaDefinition
> {}
export const healthProbeHeadersSchema: HealthProbeHeadersSchema =
  healthProbeHeadersSchemaDefinition;

export type HealthProbeHeaders = z.infer<typeof healthProbeHeadersSchema>;

/** `/api/health/scenarios` names the run plan, by id or slug, it launches one run of. */
const scenarioCanaryQuerySchemaDefinition = z.object({ runPlanId: z.string().optional() });
export interface ScenarioCanaryQuerySchema extends Named<
  typeof scenarioCanaryQuerySchemaDefinition
> {}
export const scenarioCanaryQuerySchema: ScenarioCanaryQuerySchema =
  scenarioCanaryQuerySchemaDefinition;

/** One project-keyed probe: which subsystem or canary, and what the caller presented. */
export type ProjectKeyedProbeRequest =
  | Readonly<{
      check: PlatformHealthCheckName;
      headers: HealthProbeHeaders;
      triggerId?: string | undefined;
      workflowId?: string | undefined;
      /** The caller's request, so a probe it no longer waits for stops. */
      signal: AbortSignal | undefined;
    }>
  | Readonly<{ check: "scenarios"; headers: HealthProbeHeaders; runPlanId: string | undefined }>;

/** The callable platform-health capability a process transport reaches. */
/** A report's query, and the caller's request so the probes stop when it goes away. */
export type PlatformHealthCheckInput = PlatformHealthQuery &
  Readonly<{ signal: AbortSignal | undefined }>;

export interface PlatformHealthApi {
  checkAll(query: PlatformHealthCheckInput): Promise<PlatformHealthReport>;
  checkOne(
    name: PlatformHealthCheckName,
    query: PlatformHealthCheckInput,
  ): Promise<PlatformHealthReport>;
}

export const PlatformHealthApi = moduleApi<PlatformHealthApi>()("platform-health");
