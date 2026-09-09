import type { PlatformHealthCheckName } from "@langwatch/platform-health-contract";

/**
 * What one subsystem answered. `not_configured` is the deployment's own gap —
 * a probe pointed at nothing — and is deliberately not a failure.
 */
export type SubsystemProbeResult = Readonly<
  | { outcome: "healthy" }
  | { outcome: "unhealthy"; detail: string }
  | { outcome: "not_configured"; detail: string }
>;

/** One subsystem, asked whether it is working right now. */
export abstract class SubsystemProbePort {
  abstract readonly name: PlatformHealthCheckName;
  abstract run(
    query: Readonly<{ triggerId?: string; workflowId?: string }>,
  ): Promise<SubsystemProbeResult>;
}
