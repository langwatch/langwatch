/**
 * @vitest-environment node
 */
import type { AgentApi, AgentOverview } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { agentFixture } from "../../app/__tests__/agent.fixture.ts";
import { agentTrpcTransport } from "../agent.trpc.ts";
import { agentTrpcCaller } from "./agent-trpc.fixture.ts";

const stored: AgentOverview = {
  ...agentFixture({
    type: "http",
    config: {
      url: "https://agent.test/chat",
      method: "POST",
      headers: [{ key: "X-Tenant-Key", value: "tenant-secret" }],
      auth: { type: "basic", username: "robot", password: "password-secret" },
    },
  }),
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
  environment: null,
  ownerUserId: null,
  hostLabel: null,
  lastSeenAt: null,
  parameters: [],
  owner: null,
  status: "offline",
  instances: [],
  selectable: true,
  notSelectableReason: null,
};

function harness() {
  const app = createApiFixture<AgentApi>({
    getAll: async () => [stored],
    getById: async () => stored,
    update: async () => stored,
  });

  return agentTrpcCaller({ declaration: agentTrpcTransport, app });
}

describe("agent reads over tRPC", () => {
  /** @scenario "An agent read never carries an HTTP credential" */
  it("answers getAll and getById with every credential value blank", async () => {
    const caller = harness();

    const [listed] = await caller.getAll({ projectId: "project_test" });
    const single = await caller.getById({ id: "agent_test", projectId: "project_test" });

    for (const agent of [listed, single]) {
      expect(JSON.stringify(agent)).not.toContain("tenant-secret");
      expect(JSON.stringify(agent)).not.toContain("password-secret");
      expect(agent?.config).toMatchObject({
        headers: [{ key: "X-Tenant-Key", value: "" }],
        auth: { type: "basic", username: "robot", password: "" },
      });
    }
  });
});

describe("agent writes over tRPC", () => {
  /** @scenario "An agent write never answers with an HTTP credential" */
  it("answers update with every credential value blank", async () => {
    const answered = await harness().update({ id: "agent_test", projectId: "project_test" });

    expect(JSON.stringify(answered)).not.toContain("tenant-secret");
    expect(JSON.stringify(answered)).not.toContain("password-secret");
    expect(answered.config).toMatchObject({
      headers: [{ key: "X-Tenant-Key", value: "" }],
      auth: { type: "basic", username: "robot", password: "" },
    });
  });
});
