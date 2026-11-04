import { describe, expect, it, vi } from "vitest";

import type { LangwatchApiClient } from "@/internal/api/client";

import { AgentsApiService } from "../agents-api.service";

const ok = (data: unknown) => ({ data, error: undefined, response: new Response(null) });

function serviceWithClient() {
  const client = {
    GET: vi.fn(async () => ok({ id: "agent_1", name: "Support", data: [] })),
    PUT: vi.fn(async () => ok({ label: "production", version: 2, versionId: "v2" })),
    DELETE: vi.fn(async () => ok({ label: "production", removed: true })),
  };
  const service = new AgentsApiService({
    langwatchApiClient: client as unknown as LangwatchApiClient,
  });
  return { client, service };
}

describe("the agents service and versions", () => {
  /** @scenario "The TypeScript SDK reads an agent at a label and moves its labels" */
  it("sends the label or version on get and calls the versions and labels routes", async () => {
    const { client, service } = serviceWithClient();

    await service.get("agent_1", { label: "production" });
    await service.get("agent_1", { version: 2 });
    await service.listVersions("agent_1");
    await service.assignLabel("agent_1", "production", 2);
    await service.removeLabel("agent_1", "production");

    expect(client.GET.mock.calls).toEqual([
      [
        "/api/v1/agents/{id}",
        { params: { path: { id: "agent_1" }, query: { label: "production" } } },
      ],
      ["/api/v1/agents/{id}", { params: { path: { id: "agent_1" }, query: { version: 2 } } }],
      ["/api/v1/agents/{agentId}/versions", { params: { path: { agentId: "agent_1" } } }],
    ]);
    expect(client.PUT).toHaveBeenCalledWith("/api/v1/agents/{agentId}/labels/{label}", {
      params: { path: { agentId: "agent_1", label: "production" } },
      body: { version: 2 },
    });
    expect(client.DELETE).toHaveBeenCalledWith("/api/v1/agents/{agentId}/labels/{label}", {
      params: { path: { agentId: "agent_1", label: "production" } },
    });
  });
});
