import { describe, expect, it } from "vitest";
import { MemoryAnnotationQueueDatabase } from "../memory.annotation-queue.database.ts";
import { MemoryAnnotationScoreRepository } from "../memory.annotation-score.repository.ts";

const scoreInput = {
  id: "score_1",
  projectId: "project_1",
  name: "Correctness",
  dataType: "BOOLEAN" as const,
  description: "Whether the answer is correct",
  options: [],
  defaultValue: { value: null, options: null },
};

describe("MemoryAnnotationScoreRepository", () => {
  it("keeps score lifecycle behavior and project scoping", async () => {
    const repository = MemoryAnnotationScoreRepository.create({
      memory: MemoryAnnotationQueueDatabase.create(),
    });

    const created = await repository.upsertScore(scoreInput);
    expect(created).toMatchObject({ id: "score_1", projectId: "project_1", active: true });

    expect(
      await repository.countAnnotationScores({ projectId: "project_1", scoreTypeIds: ["score_1"] }),
    ).toBe(1);

    expect(await repository.listScoreNames({ projectId: "project_1" })).toEqual([
      { id: "score_1", name: "Correctness" },
    ]);

    await repository.toggleScore({ id: "score_1", projectId: "project_1", active: false });
    expect(await repository.listScores({ projectId: "project_1", activeOnly: true })).toEqual([]);

    await repository.deleteScore({ id: "score_1", projectId: "project_1" });

    await expect(repository.getScore({ id: "score_1", projectId: "project_1" })).rejects.toThrow(
      "score_1",
    );

    expect(
      await repository.countAnnotationScores({ projectId: "project_2", scoreTypeIds: ["score_1"] }),
    ).toBe(0);
  });
});
