import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";

vi.mock("@/client-sdk/services/agents/agents-api.service", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, AgentsApiService: vi.fn() };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "test-key", source: "env" })),
}));

import { agentDeployCommand, agentUndeployCommand, agentVersionsCommand } from "../versions";

const versionRow = (version: number, labels: string[]) => ({
  id: `version_${version}`,
  version,
  commitMessage: version === 2 ? "Shorter replies" : null,
  authorKind: "user",
  author: { id: "user_ada", name: "Ada", email: "ada@example.com" },
  createdAt: "2026-08-01T00:00:00Z",
  labels,
});

const service = {
  get: vi.fn(async () => ({ id: "agent_1", name: "Support", version: 2 })),
  listVersions: vi.fn(async () => ({
    data: [versionRow(2, []), versionRow(1, ["production"])],
    labels: [{ label: "production", version: 1 }],
  })),
  assignLabel: vi.fn(async (_id: string, label: string, version: number) => ({
    label,
    version,
    versionId: `version_${version}`,
  })),
  removeLabel: vi.fn(async (_id: string, label: string) => ({ label, removed: true })),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(AgentsApiService).mockImplementation(function () {
    return service as unknown as AgentsApiService;
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("the agent version commands", () => {
  /** @scenario "The CLI lists an agent's versions and deploys a label" */
  it("lists versions newest first, deploys to a version or the latest, and undeploys", async () => {
    const listed = await agentVersionsCommand("agent_1");
    expect((listed.data as { version: number }[]).map((row) => row.version)).toEqual([2, 1]);
    listed.table();
    const printed = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join("\n");
    expect(printed).toMatch(/v1.*production/);

    const pinned = await agentDeployCommand("agent_1", "production", { version: "1" });
    expect(pinned.data).toEqual({ label: "production", version: 1 });
    const latest = await agentDeployCommand("agent_1", "staging");
    expect(latest.data).toEqual({ label: "staging", version: 2 });
    expect(service.assignLabel.mock.calls).toEqual([
      ["agent_1", "production", 1],
      ["agent_1", "staging", 2],
    ]);

    const removed = await agentUndeployCommand("agent_1", "production");
    expect(removed.data).toEqual({ label: "production", removed: true });
    expect(service.removeLabel).toHaveBeenCalledWith("agent_1", "production");
  });
});
