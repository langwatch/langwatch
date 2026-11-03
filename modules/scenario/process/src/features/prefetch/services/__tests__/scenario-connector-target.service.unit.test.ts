/**
 * What a connector agent's run carries to its child (ADR-194): the blocks, only the named secrets,
 * the fixture rows, or the refusal every block fails with.
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { AgentNotFoundError, type Agent, type AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi, DatasetPage } from "@langwatch/dataset-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";

import { ScenarioConnectorTargetService } from "../scenario-connector-target.service.ts";

const PROJECT_ID = "project-1";
const NOT_RELEASED = "Connector steps are not released for this project yet.";
const call = { language: "python" as const, code: "def execute(input):\n    return {}\n" };

function connectorAgent(
  config: Partial<Extract<Agent, { type: "connector" }>["config"]> = {},
): Agent {
  return {
    id: "agent-1",
    projectId: PROJECT_ID,
    name: "Shop connector",
    type: "connector",
    config: { call, secretNames: [], ...config },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function page(entries: Record<string, unknown>[], count = entries.length): DatasetPage {
  return {
    id: "dataset_1",
    name: "Fixtures",
    columnTypes: [],
    datasetRecords: entries.map((entry, index) => ({
      id: `record_${index}`,
      datasetId: "dataset_1",
      projectId: PROJECT_ID,
      entry,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    count,
    page: 1,
    limit: 1000,
    totalPages: 1,
  };
}

function serviceWith({
  agent = connectorAgent(),
  released = true,
  projectSecrets = {},
  dataset = null,
}: {
  agent?: Agent | "missing";
  released?: boolean | "unreadable";
  projectSecrets?: Record<string, string>;
  dataset?: DatasetPage | null;
}) {
  const reads = { secretNames: [] as string[][], datasets: [] as string[] };
  const agents: Pick<AgentApi, "getById"> = {
    getById: async () => {
      if (agent === "missing") throw new AgentNotFoundError("agent-1");
      return agent as Awaited<ReturnType<AgentApi["getById"]>>;
    },
  };
  const secrets: Pick<SecretApi, "getValuesByName"> = {
    getValuesByName: async ({ names }) => {
      reads.secretNames.push(names);
      return Object.fromEntries(
        Object.entries(projectSecrets).filter(([name]) => names.includes(name)),
      );
    },
  };
  const datasets: Pick<DatasetApi, "findDatasetPage"> = {
    findDatasetPage: async ({ slugOrId }) => {
      reads.datasets.push(slugOrId);
      return dataset;
    },
  };
  const featureFlags: Pick<FeatureFlagApi, "isEnabled"> = {
    isEnabled: async () => {
      if (released === "unreadable") throw new Error("flag store unreachable");
      return released;
    },
  };
  const service = ScenarioConnectorTargetService.create({
    agents,
    secrets,
    datasets,
    featureFlags,
  });
  const read = (runSecretValues: Record<string, string> = {}) =>
    service.getConnectorTarget({ projectId: PROJECT_ID, agentId: "agent-1", runSecretValues });
  return { read, reads };
}

describe("ScenarioConnectorTargetService", () => {
  describe("given a released project and a connector agent naming one of two secrets", () => {
    /** @scenario "A connector agent's blocks receive only the secrets it names" */
    it("carries the named secret and not the other", async () => {
      const { read, reads } = serviceWith({
        agent: connectorAgent({ secretNames: ["SHOP_ADMIN_KEY"] }),
        projectSecrets: { SHOP_ADMIN_KEY: "admin-value", OTHER_KEY: "other-value" },
      });

      const data = await read();

      expect(data?.secrets).toEqual({ SHOP_ADMIN_KEY: "admin-value" });
      expect(reads.secretNames).toEqual([["SHOP_ADMIN_KEY"]]);
    });

    it("lets a run's own value of a named secret win, and drops one it does not name", async () => {
      const { read } = serviceWith({
        agent: connectorAgent({ secretNames: ["SHOP_ADMIN_KEY"] }),
        projectSecrets: { SHOP_ADMIN_KEY: "admin-value" },
      });

      const data = await read({ SHOP_ADMIN_KEY: "run-value", UNNAMED: "x" });

      expect(data?.secrets).toEqual({ SHOP_ADMIN_KEY: "run-value" });
    });
  });

  describe("given a released project and a connector agent with every block", () => {
    /** @scenario "With the release flag on a connector agent's blocks run" */
    it("carries the blocks, the capped call budget and no refusal", async () => {
      const setup = { language: "python" as const, code: "def execute(input): ..." };
      const { read } = serviceWith({
        agent: connectorAgent({ setup, teardown: setup, timeoutMs: 999_999 }),
      });

      await expect(read()).resolves.toEqual({
        type: "connector",
        agentId: "agent-1",
        call,
        setup,
        teardown: setup,
        secrets: {},
        timeoutMs: 300_000,
      });
    });
  });

  describe("given a project without the release flag", () => {
    /** @scenario "Without the release flag a connector agent runs no block and is not scored" */
    it("carries the refusal and reads no secret and no fixture row", async () => {
      const { read, reads } = serviceWith({
        released: false,
        agent: connectorAgent({ secretNames: ["SHOP_ADMIN_KEY"], fixturesDatasetId: "dataset_1" }),
        projectSecrets: { SHOP_ADMIN_KEY: "admin-value" },
        dataset: page([{ persona: "gold" }]),
      });

      const data = await read();

      expect(data).toMatchObject({ refusal: NOT_RELEASED, secrets: {} });
      expect(data).not.toHaveProperty("rows");
      expect(reads).toEqual({ secretNames: [], datasets: [] });
    });

    it("reads an unreadable flag as off", async () => {
      const { read } = serviceWith({ released: "unreadable" });

      await expect(read()).resolves.toMatchObject({ refusal: NOT_RELEASED });
    });
  });

  describe("given a connector agent naming a secret the project does not have", () => {
    /** @scenario "A connector agent that names a missing secret fails setup before any block runs" */
    it("carries a refusal naming the secret and no secret value", async () => {
      const { read } = serviceWith({
        agent: connectorAgent({ secretNames: ["SHOP_ADMIN_KEY", "GONE_KEY"] }),
        projectSecrets: { SHOP_ADMIN_KEY: "admin-value" },
      });

      const data = await read();

      expect(data?.refusal).toContain("GONE_KEY");
      expect(data?.secrets).toEqual({});
    });
  });

  describe("given a fixtures dataset", () => {
    /** @scenario "Every connector block gets the run, the parameters, the fixture rows and its idempotency key" */
    it("carries its rows", async () => {
      const rows = [{ persona: "gold" }, { persona: "basic" }];
      const { read } = serviceWith({
        agent: connectorAgent({ fixturesDatasetId: "dataset_1" }),
        dataset: page(rows),
      });

      await expect(read()).resolves.toMatchObject({ rows });
    });

    /** @scenario "A connector agent whose fixtures are over 64 KiB fails setup before any block runs" */
    it("carries a refusal naming the cap when the rows are over 64 KiB", async () => {
      const { read } = serviceWith({
        agent: connectorAgent({ fixturesDatasetId: "dataset_1" }),
        dataset: page([{ text: "x".repeat(64 * 1024) }]),
      });

      const data = await read();

      expect(data?.refusal).toContain("64 KiB");
      expect(data).not.toHaveProperty("rows");
    });

    it("carries a refusal naming the row limit when the dataset has more rows than a page", async () => {
      const { read } = serviceWith({
        agent: connectorAgent({ fixturesDatasetId: "dataset_1" }),
        dataset: page([{ persona: "gold" }], 1001),
      });

      await expect(read()).resolves.toMatchObject({
        refusal: expect.stringContaining("1000 rows"),
      });
    });

    /** @scenario "A connector agent whose fixtures dataset was deleted fails setup before any block runs" */
    it("carries a refusal saying the dataset no longer exists", async () => {
      const { read } = serviceWith({
        agent: connectorAgent({ fixturesDatasetId: "dataset_gone" }),
        dataset: null,
      });

      await expect(read()).resolves.toMatchObject({
        refusal: "The connector's fixtures dataset no longer exists.",
      });
    });
  });

  describe("given an agent that is gone or is not a connector", () => {
    it("throws target not found", async () => {
      const notFound = { code: "scenario_target_not_found" };
      await expect(serviceWith({ agent: "missing" }).read()).rejects.toMatchObject(notFound);
      const http = { ...connectorAgent(), type: "http", config: { url: "u", method: "POST" } };
      await expect(serviceWith({ agent: http as Agent }).read()).rejects.toMatchObject(notFound);
    });
  });
});
