import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";

vi.mock("@/client-sdk/services/evaluators", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, EvaluatorsApiService: vi.fn() };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "test-key", source: "env" })),
}));

import {
  evaluatorDeployCommand,
  evaluatorUndeployCommand,
  evaluatorVersionsCommand,
} from "../versions";

const versionRow = (version: number, labels: string[]) => ({
  id: `version_${version}`,
  version,
  commitMessage: version === 2 ? "Raise the threshold" : null,
  authorKind: "api_key",
  author: null,
  createdAt: "2026-08-01T00:00:00Z",
  labels,
});

const service = {
  get: vi.fn(async () => ({ id: "evaluator_1", name: "Toxicity", slug: "toxicity" })),
  getAll: vi.fn(async () => []),
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
  vi.mocked(EvaluatorsApiService).mockImplementation(function () {
    return service as unknown as EvaluatorsApiService;
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("the evaluator version commands", () => {
  /** @scenario "The CLI lists an evaluator's versions and deploys a label" */
  it("lists versions newest first, deploys to a version or the latest, and undeploys", async () => {
    const listed = await evaluatorVersionsCommand("toxicity");
    expect((listed.data as { version: number }[]).map((row) => row.version)).toEqual([2, 1]);
    listed.table();
    const printed = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join("\n");
    expect(printed).toMatch(/v1.*production/);
    expect(printed).toMatch(/API key/);

    const pinned = await evaluatorDeployCommand("toxicity", "production", { version: "1" });
    expect(pinned.data).toEqual({ label: "production", version: 1 });
    const latest = await evaluatorDeployCommand("toxicity", "staging");
    expect(latest.data).toEqual({ label: "staging", version: 2 });
    expect(service.assignLabel.mock.calls).toEqual([
      ["evaluator_1", "production", 1],
      ["evaluator_1", "staging", 2],
    ]);

    await evaluatorUndeployCommand("toxicity", "production");
    expect(service.removeLabel).toHaveBeenCalledWith("evaluator_1", "production");
  });
});
