import type { AgentWithFields } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";
import { RpcClientPort } from "../src/features/agent/behavior/rpc-client.port";
import { TrpcAgentBrowserAdapter } from "../src/features/agent/behavior/trpc-agent-browser.adapter";

type RpcCall = {
  kind: "query" | "mutation";
  path: string;
  input: unknown;
};

class RecordingRpc extends RpcClientPort {
  readonly calls: RpcCall[] = [];

  constructor(private readonly responses: Map<string, unknown>) {
    super();
  }

  query(path: string, input: unknown): Promise<unknown> {
    this.calls.push({ kind: "query", path, input });
    return Promise.resolve(this.responses.get(path));
  }

  mutate(path: string, input: unknown): Promise<unknown> {
    this.calls.push({ kind: "mutation", path, input });
    return Promise.resolve(this.responses.get(path));
  }
}

const agent: AgentWithFields = {
  id: "agent_1",
  projectId: "project_1",
  name: "HTTP agent",
  type: "http",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  config: {
    name: "HTTP",
    description: "HTTP API endpoint",
    url: "https://example.test/run",
    method: "POST",
  },
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
};

describe("TrpcAgentBrowserAdapter", () => {
  it("maps project reads to the existing Agent tRPC procedure", async () => {
    const rpc = new RecordingRpc(new Map([["agents.getById", agent]]));
    const browser = TrpcAgentBrowserAdapter.create(rpc);

    const result = await browser.getById({ id: "agent_1", projectId: "project_1" });

    expect(result).toEqual(agent);
    expect(rpc.calls).toEqual([
      {
        kind: "query",
        path: "agents.getById",
        input: { id: "agent_1", projectId: "project_1" },
      },
    ]);
  });

  it("keeps the legacy copy input and output shape", async () => {
    const copied = {
      id: "agent_copy",
      projectId: "project_2",
      name: "HTTP agent",
      copiedFromAgentId: "agent_1",
    };
    const rpc = new RecordingRpc(new Map([["agents.copy", copied]]));
    const browser = TrpcAgentBrowserAdapter.create(rpc);
    const input = {
      agentId: "agent_1",
      projectId: "project_2",
      sourceProjectId: "project_1",
    };

    await expect(browser.copy(input)).resolves.toEqual(copied);
    expect(rpc.calls).toEqual([{ kind: "mutation", path: "agents.copy", input }]);
  });

  it("maps archive, replica, sync, and history operations to their legacy procedures", async () => {
    const rpc = new RecordingRpc(
      new Map<string, unknown>([
        ["agents.getRelatedEntities", { workflow: null }],
        ["agents.cascadeArchive", { agent, archivedWorkflow: null }],
        ["agents.delete", agent],
        [
          "agents.getCopies",
          [
            {
              id: "agent_copy",
              name: "Agent copy",
              projectId: "project_2",
              fullPath: "Org / Team",
            },
          ],
        ],
        ["agents.pushToCopies", { pushedTo: 1, selectedCopies: 1 }],
        ["agents.syncFromSource", { ok: true }],
        [
          "agents.getHistory",
          [
            {
              id: "history_1",
              action: "updated",
              createdAt: new Date("2026-01-03T00:00:00.000Z"),
              args: {},
              user: null,
            },
          ],
        ],
      ]),
    );
    const browser = TrpcAgentBrowserAdapter.create(rpc);
    const archiveInput = { id: "agent_1", projectId: "project_1" };
    const copiesInput = { agentId: "agent_1", projectId: "project_1" };

    await browser.relatedEntities(archiveInput);
    await browser.cascadeArchive(archiveInput);
    await browser.archive(archiveInput);
    await browser.getCopies(copiesInput);
    await browser.pushToCopies({ ...copiesInput, copyIds: ["agent_copy"] });
    await browser.syncFromSource(copiesInput);
    await browser.getHistory(copiesInput);

    expect(rpc.calls.map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: "query", path: "agents.getRelatedEntities" },
      { kind: "mutation", path: "agents.cascadeArchive" },
      { kind: "mutation", path: "agents.delete" },
      { kind: "query", path: "agents.getCopies" },
      { kind: "mutation", path: "agents.pushToCopies" },
      { kind: "mutation", path: "agents.syncFromSource" },
      { kind: "query", path: "agents.getHistory" },
    ]);
  });

  it("rejects a malformed response at the browser transport boundary", async () => {
    const rpc = new RecordingRpc(new Map([["agents.pushToCopies", { pushedTo: "1" }]]));
    const browser = TrpcAgentBrowserAdapter.create(rpc);

    await expect(
      browser.pushToCopies({
        agentId: "agent_1",
        projectId: "project_1",
        copyIds: ["agent_copy"],
      }),
    ).rejects.toThrow();
  });
});
