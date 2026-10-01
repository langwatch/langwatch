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

/** What a probe is asked about, and the caller's request its canaries stop with. */
export type SubsystemProbeQuery = Readonly<{
  triggerId?: string;
  workflowId?: string;
  signal: AbortSignal | undefined;
}>;

/** One subsystem, asked whether it is working right now. */
export interface SubsystemProbe {
  readonly name: PlatformHealthCheckName;
  run(query: SubsystemProbeQuery): Promise<SubsystemProbeResult>;
}
