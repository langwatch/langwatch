import { memoryObjectStorage } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import type {
  EvaluationInputStorage,
  StoredEvaluationInput,
} from "../../app/evaluation.members.ts";
import { MemoryEvaluationInputRepository } from "../memory/memory.evaluation-input.repository.ts";
import { ObjectStorageEvaluationInputRepository } from "../object-storage/object-storage.evaluation-input.repository.ts";

const bytes = new TextEncoder().encode('{"input":"large"}');

async function textOf(read: StoredEvaluationInput): Promise<string | undefined> {
  if (read.kind === "absent") return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of read.body) chunks.push(chunk);
  return new TextDecoder().decode(Buffer.concat(chunks));
}

describe.each([
  [
    "object storage",
    () => ObjectStorageEvaluationInputRepository.create({ objectStorage: memoryObjectStorage() }),
  ],
  ["memory", () => MemoryEvaluationInputRepository.create()],
] as const)("the %s evaluation input repository", (_tier, create: () => EvaluationInputStorage) => {
  describe("given stored inputs", () => {
    it("reads them back by the id the store returned", async () => {
      const repository = create();
      const { id } = await repository.store({
        tenantId: "project-1",
        evaluationId: "eval-1",
        bytes,
      });

      expect(id).toMatch(/^[a-f0-9]{64}$/u);
      expect(await textOf(await repository.read({ tenantId: "project-1", id }))).toBe(
        '{"input":"large"}',
      );
    });

    it("answers nothing for another tenant", async () => {
      const repository = create();
      const { id } = await repository.store({
        tenantId: "project-1",
        evaluationId: "eval-1",
        bytes,
      });

      expect(await repository.read({ tenantId: "project-2", id })).toEqual({ kind: "absent" });
    });
  });

  describe("given an id that is not a stored-input hash", () => {
    it("answers nothing", async () => {
      expect(await create().read({ tenantId: "project-1", id: "../secrets" })).toEqual({
        kind: "absent",
      });
    });
  });
});
