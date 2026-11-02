import {
  CONNECTOR_ROWS_MAX_BYTES,
  type Connector,
  type ConnectorStep,
} from "@langwatch/agent-contract";
import { DATASET_PAGE_LIMIT_MAX, type DatasetApi } from "@langwatch/dataset-contract";
import type { ConnectorData, ConnectorStepData } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";

import {
  CONNECTOR_STEPS_NOT_RELEASED_MESSAGE,
  type ConnectorStepsGate,
} from "../../../services/scenario-connector-steps-gate.service.ts";

/** The dataset read a Connector step's rows need. */
export type ConnectorDatasetReader = Pick<DatasetApi, "findDatasetPage">;

export class ConnectorStepPrefetchService {
  static create(options: {
    secrets: SecretApi;
    datasets: ConnectorDatasetReader;
    connectorSteps: ConnectorStepsGate;
  }): ConnectorStepPrefetchService {
    return new ConnectorStepPrefetchService(options);
  }

  private constructor(
    private readonly options: {
      secrets: SecretApi;
      datasets: ConnectorDatasetReader;
      connectorSteps: ConnectorStepsGate;
    },
  ) {}

  /** An HTTP agent's Connector steps with what each may read, or nothing without a step. */
  async connectorData({
    projectId,
    connector,
    runSecretValues,
  }: {
    projectId: string;
    connector: Connector | undefined;
    runSecretValues: Record<string, string>;
  }): Promise<{ connector?: ConnectorData }> {
    if (!connector?.setup && !connector?.teardown) return {};
    const released = await this.options.connectorSteps.isEnabled({ projectId });
    const stepData = (step: ConnectorStep | undefined) => {
      if (!step) return undefined;
      return released
        ? this.connectorStepData({ projectId, step, runSecretValues })
        : this.unreleasedStepData(step);
    };
    const [setup, teardown] = await Promise.all([
      stepData(connector.setup),
      stepData(connector.teardown),
    ]);
    return { connector: { ...(setup ? { setup } : {}), ...(teardown ? { teardown } : {}) } };
  }

  /** A step the release withholds: no secrets or rows are read, it only carries its refusal. */
  private unreleasedStepData(step: ConnectorStep): ConnectorStepData {
    return {
      language: step.language,
      code: step.code,
      secretNames: [],
      secrets: {},
      refusal: CONNECTOR_STEPS_NOT_RELEASED_MESSAGE,
    };
  }

  /** Only the secrets the step names travel to it; a run's own value of one wins (ADR-194). */
  private async connectorStepData({
    projectId,
    step,
    runSecretValues,
  }: {
    projectId: string;
    step: ConnectorStep;
    runSecretValues: Record<string, string>;
  }): Promise<ConnectorStepData> {
    const { secretNames } = step;
    const projectValues =
      secretNames.length === 0
        ? {}
        : await this.options.secrets.getValuesByName({ projectId, names: secretNames });
    const runValues = Object.fromEntries(
      Object.entries(runSecretValues).filter(([name]) => secretNames.includes(name)),
    );
    return {
      language: step.language,
      code: step.code,
      secretNames,
      secrets: { ...projectValues, ...runValues },
      ...(step.datasetId ? await this.connectorRows({ projectId, datasetId: step.datasetId }) : {}),
    };
  }

  /** The bound dataset's entries, or why the step cannot have them (it then fails unrun). */
  private async connectorRows({
    projectId,
    datasetId,
  }: {
    projectId: string;
    datasetId: string;
  }): Promise<Pick<ConnectorStepData, "rows" | "refusal">> {
    const page = await this.options.datasets.findDatasetPage({
      projectId,
      slugOrId: datasetId,
      limit: DATASET_PAGE_LIMIT_MAX,
    });
    if (!page) return { refusal: "The Connector step's dataset no longer exists." };
    const rows = page.datasetRecords.map(({ entry }) => entry);
    const isOverCap =
      page.count > rows.length ||
      Buffer.byteLength(JSON.stringify(rows), "utf8") > CONNECTOR_ROWS_MAX_BYTES;
    if (!isOverCap) return { rows };
    return {
      refusal: `The Connector step's dataset is over the ${CONNECTOR_ROWS_MAX_BYTES / 1024} KiB a step may receive.`,
    };
  }
}
