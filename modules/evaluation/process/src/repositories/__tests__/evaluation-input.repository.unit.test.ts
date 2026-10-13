import { memoryObjectStorage } from "@langwatch/process-stores";
import type { ObjectStorage } from "@langwatch/process-stores/members";
import { describe, expect, it } from "vitest";

import {
  evaluationInputKey,
  legacyEvaluationInputKey,
} from "../../rules/evaluation-input-object.rules.ts";
import type {
  EvaluationInputRepository,
  StoredEvaluationInput,
} from "../evaluation-input.repository.ts";
import { MemoryEvaluationInputRepository } from "../memory/memory.evaluation-input.repository.ts";
import {
  EvaluationInputDestinationUnsupportedError,
  ObjectStorageEvaluationInputRepository,
} from "../object-storage/object-storage.evaluation-input.repository.ts";

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
] as const)(
  "the %s evaluation input repository",
  (_tier, create: () => EvaluationInputRepository) => {
    describe("given stored inputs", () => {
      /** @scenario the offload key is derived from the content and recorded in the marker */
      it("keys them by class, project and content hash, and reads them back by that key", async () => {
        const repository = create();
        const stored = await repository.store({
          tenantId: "project-1",
          retentionClass: "r365",
          bytes,
        });
        const again = await repository.store({
          tenantId: "project-1",
          retentionClass: "r365",
          bytes,
        });

        expect(stored.key).toBe(
          evaluationInputKey({
            retentionClass: "r365",
            tenantId: "project-1",
            sha256: stored.sha256,
          }),
        );
        expect(again).toEqual(stored);
        expect(
          await textOf(await repository.read({ tenantId: "project-1", key: stored.key })),
        ).toBe('{"input":"large"}');
      });

      /** @scenario a marker that names another project's object is never read */
      it("answers nothing for another tenant", async () => {
        const repository = create();
        const stored = await repository.store({
          tenantId: "project-1",
          retentionClass: "r90",
          bytes,
        });

        expect(await repository.read({ tenantId: "project-2", key: stored.key })).toEqual({
          kind: "absent",
        });
      });
    });

    describe("given a key that is not a stored-input key", () => {
      it("answers nothing", async () => {
        expect(await create().read({ tenantId: "project-1", key: "../secrets" })).toEqual({
          kind: "absent",
        });
      });
    });
  },
);

describe("the object storage evaluation input repository", () => {
  /** @scenario a run offloaded before the move is read from its old address */
  it("reads an object main wrote at <projectId>/<sha256>", async () => {
    const objectStorage = memoryObjectStorage();
    const sha256 = "c".repeat(64);
    await objectStorage.write(
      { projectId: "project-1", key: legacyEvaluationInputKey({ tenantId: "project-1", sha256 }) },
      (async function* () {
        yield bytes;
      })(),
      { byteLength: bytes.byteLength, contentType: "application/json" },
    );
    const repository = ObjectStorageEvaluationInputRepository.create({ objectStorage });

    const key = legacyEvaluationInputKey({ tenantId: "project-1", sha256 });
    expect(await textOf(await repository.read({ tenantId: "project-1", key }))).toBe(
      '{"input":"large"}',
    );
  });

  /** @scenario a filesystem destination keeps the inputs as a preview marker */
  it("refuses to write to a destination that cannot expire objects", async () => {
    const objectStorage: ObjectStorage = {
      ...memoryObjectStorage(),
      destination: async () => ({ kind: "file", root: "/var/lib/langwatch" }),
    };
    const repository = ObjectStorageEvaluationInputRepository.create({ objectStorage });

    await expect(
      repository.store({ tenantId: "project-1", retentionClass: "r90", bytes }),
    ).rejects.toBeInstanceOf(EvaluationInputDestinationUnsupportedError);
  });
});
