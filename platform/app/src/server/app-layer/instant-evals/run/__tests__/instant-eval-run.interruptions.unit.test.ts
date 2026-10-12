import { describe, expect, it, vi } from "vitest";
import { toInstantEvalExplorerRun } from "../instant-eval-explorer";
import type { InstantEvalRunRow } from "../instant-eval-run.repository";
import { InstantEvalRunService } from "../instant-eval-run.service";

vi.mock("../input", () => ({ resolveInstantEvalStatement: vi.fn() }));
vi.mock("../instant-eval-reads", () => ({
  readInstantEvalResults: vi.fn(),
  readInstantEvalSample: vi.fn(),
}));
vi.mock("../instant-eval-estimate", () => ({
  estimateInstantEvalRun: vi.fn(),
}));
vi.mock("../statement", () => ({ acceptInstantEvalStatement: vi.fn() }));
const block = {
  code: "instant_eval_processing_disabled",
  observedAtMs: 100,
  stages: [{ componentType: "command", componentName: "recordPageJudged" }],
} as const;
const row = {
  id: "run-1",
  projectId: "project-1",
  status: "FINISHED",
  total: 100,
  progress: 20,
  error: null,
  finishedAt: new Date(200),
} as InstantEvalRunRow;
function service() {
  const blocksForRuns = vi.fn(async () => ({ "run-1": block }));
  const value = new InstantEvalRunService({
    runs: { findById: async () => row, list: async () => [row] } as never,
    interruptions: { blocksForRuns } as never,
    isEnabled: async () => true,
    caller: async () => ({ id: "project-1", lwqlKey: "local-fake" }),
  } as never);
  return { value, blocksForRuns };
}
describe("Instant Eval interruption read view", () => {
  /** @scenario Interruption evidence survives flag restoration and terminal reporting */
  it("returns persistent impairment alongside original terminal facts on fresh get and list", async () => {
    const h = service();
    const result = await h.value.get({
      projectId: "project-1",
      runId: "run-1",
    });
    expect(result).toEqual({ ...row, processingBlock: block });
    const list = await service().value.list({
      projectId: "project-1",
      limit: 20,
    });
    expect(list).toEqual([{ ...row, processingBlock: block }]);
    expect(toInstantEvalExplorerRun(result)).toMatchObject({
      status: "finished",
      progress: 20,
      error: null,
      finishedAtMs: 200,
      processingBlock: block,
    });
    expect(h.blocksForRuns).toHaveBeenCalledWith({
      projectId: "project-1",
      runIds: ["run-1"],
    });
  });
  it("refuses healthy reporting when receipt reads fail", async () => {
    const h = service();
    h.blocksForRuns.mockRejectedValue(new Error("receipt unavailable"));
    await expect(
      h.value.get({ projectId: "project-1", runId: "run-1" }),
    ).rejects.toThrow("receipt unavailable");
    await expect(
      h.value.list({ projectId: "project-1", limit: 20 }),
    ).rejects.toThrow("receipt unavailable");
  });
});
