/**
 * Reads what a Scenario Connector agent's run needs before its child starts (ADR-194): the
 * blocks, only the secrets the agent names, the fixture rows, and whether the release is on.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import {
  AgentNotFoundError,
  CONNECTOR_ROWS_MAX_BYTES,
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
  type AgentApi,
  type ConnectorAgentConfig,
} from "@langwatch/agent-contract";
import { DATASET_PAGE_LIMIT_MAX, type DatasetApi } from "@langwatch/dataset-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import { type ConnectorAgentData, ScenarioTargetNotFoundError } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";

const logger = createLogger("langwatch:scenarios:connector-target");

/** The release gate for Scenario Connector blocks (ADR-194), off by default everywhere. */
const SCENARIO_CONNECTOR_STEPS_FLAG_KEY = "release_scenario_connector_steps";

/** What every block of a connector agent records while the release is off for its project. */
const SCENARIO_CONNECTOR_NOT_RELEASED_MESSAGE =
  "Connector steps are not released for this project yet.";

type ConnectorTargetOptions = {
  agents: Pick<AgentApi, "getById">;
  secrets: Pick<SecretApi, "getValuesByName">;
  datasets: Pick<DatasetApi, "findDatasetPage">;
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
};

/** What the target prefetch reads a connector agent through. */
export interface ConnectorTargetReader {
  /**
   * The run's connector data.
   * @throws ScenarioTargetNotFoundError when the agent is gone or is not a connector.
   */
  getConnectorTarget(input: {
    projectId: string;
    agentId: string;
    runSecretValues: Record<string, string>;
  }): Promise<ConnectorAgentData>;
}

export class ScenarioConnectorTargetService implements ConnectorTargetReader {
  static create(options: ConnectorTargetOptions): ScenarioConnectorTargetService {
    return new ScenarioConnectorTargetService(options);
  }

  private constructor(private readonly options: ConnectorTargetOptions) {}

  async getConnectorTarget({
    projectId,
    agentId,
    runSecretValues,
  }: {
    projectId: string;
    agentId: string;
    runSecretValues: Record<string, string>;
  }): Promise<ConnectorAgentData> {
    const agent = await this.tryGetAgent({ projectId, agentId });
    if (agent?.type !== "connector") {
      throw new ScenarioTargetNotFoundError({ targetType: "connector", referenceId: agentId });
    }
    const { config } = agent;
    const blocks: ConnectorAgentData = {
      type: "connector",
      agentId: agent.id,
      call: config.call,
      ...(config.setup ? { setup: config.setup } : {}),
      ...(config.teardown ? { teardown: config.teardown } : {}),
      secrets: {},
      timeoutMs: Math.min(config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS),
    };
    // Off, nothing the blocks would read is loaded: no secret value and no fixture row.
    if (!(await this.isReleased(projectId))) {
      return { ...blocks, refusal: SCENARIO_CONNECTOR_NOT_RELEASED_MESSAGE };
    }
    return { ...blocks, ...(await this.readable({ projectId, config, runSecretValues })) };
  }

  private async tryGetAgent({ projectId, agentId }: { projectId: string; agentId: string }) {
    try {
      return await this.options.agents.getById({ projectId, id: agentId });
    } catch (error) {
      if (error instanceof AgentNotFoundError) return null;
      throw error;
    }
  }

  /** A flag read that fails answers off: no block runs on a guess. */
  private async isReleased(projectId: string): Promise<boolean> {
    try {
      return await this.options.featureFlags.isEnabled(SCENARIO_CONNECTOR_STEPS_FLAG_KEY, {
        kind: "project",
        projectId,
      });
    } catch (error) {
      logger.warn({ error, projectId }, "Connector release flag read failed; treating it as off");
      return false;
    }
  }

  /** The named secrets (a run's own value of one wins) and the rows, or why no block can run. */
  private async readable({
    projectId,
    config,
    runSecretValues,
  }: {
    projectId: string;
    config: ConnectorAgentConfig;
    runSecretValues: Record<string, string>;
  }): Promise<Pick<ConnectorAgentData, "secrets" | "rows" | "refusal">> {
    const { secretNames } = config;
    const projectValues =
      secretNames.length === 0
        ? {}
        : await this.options.secrets.getValuesByName({ projectId, names: secretNames });
    const runValues = Object.fromEntries(
      Object.entries(runSecretValues).filter(([name]) => secretNames.includes(name)),
    );
    const secrets = { ...projectValues, ...runValues };
    const missing = secretNames.filter((name) => !Object.hasOwn(secrets, name));
    if (missing.length > 0) {
      return {
        secrets: {},
        refusal: `The connector names project secrets that do not exist: ${missing.join(", ")}.`,
      };
    }
    if (!config.fixturesDatasetId) return { secrets };
    const fixtures = await this.fixtureRows({ projectId, datasetId: config.fixturesDatasetId });
    return "refusal" in fixtures
      ? { secrets: {}, refusal: fixtures.refusal }
      : { secrets, ...fixtures };
  }

  private async fixtureRows({
    projectId,
    datasetId,
  }: {
    projectId: string;
    datasetId: string;
  }): Promise<{ rows: Record<string, unknown>[] } | { refusal: string }> {
    const page = await this.options.datasets.findDatasetPage({
      projectId,
      slugOrId: datasetId,
      limit: DATASET_PAGE_LIMIT_MAX,
    });
    if (!page) return { refusal: "The connector's fixtures dataset no longer exists." };
    const rows = page.datasetRecords.map(({ entry }) => entry);
    if (page.count > rows.length) {
      return {
        refusal: `The connector's fixtures dataset has more than the ${DATASET_PAGE_LIMIT_MAX} rows a block may receive.`,
      };
    }
    if (Buffer.byteLength(JSON.stringify(rows), "utf8") > CONNECTOR_ROWS_MAX_BYTES) {
      return {
        refusal: `The connector's fixtures dataset is over the ${CONNECTOR_ROWS_MAX_BYTES / 1024} KiB a block may receive.`,
      };
    }
    return { rows };
  }
}
