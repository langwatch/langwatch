import type { AgentService } from "@langwatch/agent-contract";
import { describe, expect, it, vi } from "vitest";
import { AgentApp } from "../src/app/agent.app";
import { AgentsRpcApi } from "../src/api/internal/agent.api";
import {
  LegacyAgentsRestApi,
  legacyAgentsApiDocumentation,
} from "../src/api/legacy-rest/agent.api";
import { agentFixture } from "../src/testing";

describe("Agents transports", () => {
  /** @scenario Legacy REST delegates to the same Agent service */
  it("keeps RPC and legacy REST as adapters over one application", async () => {
    const create = vi.fn(async () => ({
      ...agentFixture(),
      inputFields: [],
      outputFields: [],
      fieldsResolved: true,
    }));
    const service = { create } as unknown as AgentService;
    const app = AgentApp.create({ agents: service });
    const rpc = AgentsRpcApi.create(app);
    const rest = LegacyAgentsRestApi.create(app);
    const input = {
      projectId: "project_1",
      name: "Answerer",
      type: "signature" as const,
      config: { prompt: "Answer clearly" },
    };

    await rpc.create(input);
    await rest.create(input);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.instances[0]).toBe(service);
    expect(create.mock.instances[1]).toBe(service);
  });

  it("marks the REST compatibility surface as legacy and deprecated", () => {
    expect(legacyAgentsApiDocumentation).toMatchObject({
      deprecated: true,
      tags: ["Legacy"],
    });
  });
});
