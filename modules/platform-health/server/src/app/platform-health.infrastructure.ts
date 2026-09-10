import type { PlatformHealthCheckName } from "@langwatch/platform-health-contract";
export interface PlatformHealthInfrastructure {  subsystemProbe: SubsystemProbe;
}

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
export interface SubsystemProbe {
  readonly name: PlatformHealthCheckName;
  run(
    query: Readonly<{ triggerId?: string; workflowId?: string }>,
  ): Promise<SubsystemProbeResult>;
}
