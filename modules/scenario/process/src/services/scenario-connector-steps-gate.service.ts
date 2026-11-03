import {
  type FeatureFlagApi,
  SCENARIO_CONNECTOR_STEPS_FLAG_KEY,
} from "@langwatch/feature-flag-contract";

/** Whether a project's runs may execute Connector steps (ADR-194). */
export type ConnectorStepsGate = { isEnabled(input: { projectId: string }): Promise<boolean> };

/** The refusal a step carries while the hosted release is off. */
export const CONNECTOR_STEPS_NOT_RELEASED_MESSAGE =
  "Connector steps are not released for this project yet.";

/**
 * Self-hosted and local deployments always run Connector steps; the hosted service waits for
 * the WebAssembly runner and releases them per project through the flag.
 */
export class ScenarioConnectorStepsGateService implements ConnectorStepsGate {
  static create(options: {
    isSaas: boolean;
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  }): ScenarioConnectorStepsGateService {
    return new ScenarioConnectorStepsGateService(options.isSaas, options.featureFlags);
  }

  private constructor(
    private readonly isSaas: boolean,
    private readonly featureFlags: Pick<FeatureFlagApi, "isEnabled">,
  ) {}

  async isEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    if (!this.isSaas) return true;
    return this.featureFlags.isEnabled(SCENARIO_CONNECTOR_STEPS_FLAG_KEY, {
      kind: "project",
      projectId,
    });
  }
}
