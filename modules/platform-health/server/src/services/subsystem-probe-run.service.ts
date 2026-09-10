import type { PlatformHealthCheckName } from "@langwatch/platform-health-contract";

import { SubsystemProbe, type SubsystemProbeResult } from "../app/platform-health.infrastructure.ts";
import type {
  SubsystemProbeOutcome,
  SubsystemProbeReason,
  SubsystemProbeService,
} from "./subsystem-probe.service.ts";

/**
 * The five probe runs, named as a shape rather than as the class, so a caller
 * composing one subsystem does not have to build the other four.
 */
export type SubsystemProbeRunner = Pick<
  SubsystemProbeService,
  "runCollector" | "runEvaluations" | "runProcessor" | "runTriggers" | "runWorkflows"
>;

/**
 * Our own words for each way a probe does not pass. The upstream's sentence
 * stays in the log: a monitoring answer says which half broke, never what the
 * other side called it.
 */
const DETAIL: Record<SubsystemProbeReason, string> = {
  canary_rest_refused: "the collector did not accept the canary trace",
  canary_otlp_refused: "the collector did not accept the canary trace over OpenTelemetry",
  evaluation_refused: "the sample evaluation did not run",
  trace_not_ingested: "the canary trace was accepted but never became readable",
  trigger_absent: "the trigger this deployment names for the probe does not exist",
  trigger_never_fired: "the trigger has never fired",
  trigger_stale: "the trigger has not fired within the last hour",
  workflow_absent: "the workflow this deployment names for the probe does not exist",
  workflow_refused: "the sample workflow did not run",
};

/** The credential and project the monitoring probes run as. */
export interface SubsystemProbeCredential {
  readonly authToken: string;
  resolveProjectId(): Promise<string | null>;
}

/**
 * One subsystem, probed with the deployment's own credential. A trigger or
 * workflow probe named no target reports `not_configured`: the platform is not
 * broken because nobody told the probe what to look at.
 */
export class SubsystemProbeAdapter implements SubsystemProbe {
  readonly name: PlatformHealthCheckName;
  readonly #probes: SubsystemProbeRunner;
  readonly #credential: SubsystemProbeCredential;

  private constructor(options: {
    name: PlatformHealthCheckName;
    probes: SubsystemProbeRunner;
    credential: SubsystemProbeCredential;
  }) {
    this.name = options.name;
    this.#probes = options.probes;
    this.#credential = options.credential;
  }

  static create(options: {
    name: PlatformHealthCheckName;
    probes: SubsystemProbeRunner;
    credential: SubsystemProbeCredential;
  }): SubsystemProbeAdapter {
    return new SubsystemProbeAdapter(options);
  }

  async run(
    query: Readonly<{ triggerId?: string; workflowId?: string }>,
  ): Promise<SubsystemProbeResult> {
    const authToken = this.#credential.authToken;

    if (this.name === "collector") return read(await this.#probes.runCollector({ authToken }));
    if (this.name === "evaluations") return read(await this.#probes.runEvaluations({ authToken }));
    if (this.name === "processor") return read(await this.#probes.runProcessor({ authToken }));

    const target = this.name === "triggers" ? query.triggerId : query.workflowId;
    if (!target) {
      return {
        outcome: "not_configured",
        detail: "this request named no target for the probe to check",
      };
    }

    const projectId = await this.#credential.resolveProjectId();
    if (!projectId) {
      return {
        outcome: "not_configured",
        detail: "the configured probe credential does not resolve to a project",
      };
    }

    return read(
      this.name === "triggers"
        ? await this.#probes.runTriggers({ projectId, triggerId: target })
        : await this.#probes.runWorkflows({ projectId, workflowId: target, authToken }),
    );
  }
}

function read(outcome: SubsystemProbeOutcome): SubsystemProbeResult {
  return outcome.ok
    ? { outcome: "healthy" }
    : { outcome: "unhealthy", detail: DETAIL[outcome.reason] };
}
