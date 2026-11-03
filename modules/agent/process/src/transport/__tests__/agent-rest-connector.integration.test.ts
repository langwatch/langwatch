/**
 * A Scenario Connector agent created and read through the `/api/v1/agents` REST family, over the
 * real Hono app (ADR-194).
 * @see modules/agent/specs/scenario-connector-agent.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { buildAgentApps } from "./agent-rest.fixture.ts";

const block = (code: string) => ({ language: "python", code });

const connectorConfig = {
  call: block("def execute(input):\n    return {'reply': 'hi'}\n"),
  setup: block("def execute(input):\n    return {'state': {'accountId': 'acc_1'}}\n"),
  teardown: block("def execute(input):\n    return {'deleted': 1}\n"),
  secretNames: ["SHOP_ADMIN_KEY", "SHOP_BASE_URL"],
  fixturesDatasetId: "dataset_1",
  timeoutMs: 30_000,
};

describe("given a project with a valid API key", () => {
  let api: Awaited<ReturnType<typeof buildAgentApps>>;

  beforeEach(async () => {
    api = await buildAgentApps();
  });

  describe("when a connector agent is created", () => {
    /** @scenario "A connector agent is created through the agent REST API" */
    it("answers 201 with the connector config, and a read answers the same", async () => {
      const created = await api.v1("/api/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Shop connector",
          type: "connector",
          config: connectorConfig,
        }),
      });
      const body = (await created.json()) as { id: string; type: string; config: unknown };

      expect(created.status).toBe(201);
      expect(body).toMatchObject({ type: "connector", config: connectorConfig });

      const read = await api.v1(`/api/v1/agents/${body.id}`);

      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ type: "connector", config: connectorConfig });
    });

    it("refuses a connector config with no call block", async () => {
      const response = await api.v1("/api/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Shop connector",
          type: "connector",
          config: { setup: connectorConfig.setup },
        }),
      });

      expect(response.status).toBe(422);
    });
  });
});
