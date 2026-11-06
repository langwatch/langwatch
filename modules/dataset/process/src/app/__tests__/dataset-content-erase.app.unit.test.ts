/**
 * @vitest-environment node
 * Erasing projects' data removes every object their datasets keep, before the rows naming them go.
 * @see specs/datasets/storage-object-only/other-postgres-copies.feature
 */
import { memoryObjectStorage } from "@langwatch/process-stores";
import type { ObjectStorage } from "@langwatch/process-stores/members";
import { describe, expect, it } from "vitest";

import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { ObjectStorageDatasetChunkRepository } from "../../repositories/object-storage/object-storage.dataset-chunk.repository.ts";
import { ObjectStorageDatasetSingleFileRepository } from "../../repositories/object-storage/object-storage.dataset-single-file.repository.ts";
import { ObjectStorageDatasetVersionContentRepository } from "../../repositories/object-storage/object-storage.dataset-version-content.repository.ts";
import { createDatasetTestApp } from "./dataset.fixture.ts";

const ERASED = "project-erased";
const KEPT = "project-kept";
const columnTypes = [{ name: "question", type: "string" as const }];

/** Memory object storage that remembers which keys hold an object right now. */
function trackedObjectStorage(): { objectStorage: ObjectStorage; live: Set<string> } {
  const storage = memoryObjectStorage();
  const live = new Set<string>();
  const objectStorage = new Proxy(storage, {
    get(target, property, receiver) {
      if (property === "write") {
        return async (...args: Parameters<ObjectStorage["write"]>) => {
          const digest = await target.write(...args);
          live.add(args[0].key);
          return digest;
        };
      }
      if (property === "remove") {
        return async (at: Parameters<ObjectStorage["remove"]>[0]) => {
          await target.remove(at);
          live.delete(at.key);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { objectStorage, live };
}

function repositoriesOver(objectStorage: ObjectStorage): DatasetRepositories {
  const chunks = ObjectStorageDatasetChunkRepository.create({ objectStorage });
  return {
    ...MemoryDatasetRepositories.create(),
    chunks,
    migrationChunks: chunks,
    singleFiles: ObjectStorageDatasetSingleFileRepository.create({ objectStorage }),
    versionContent: ObjectStorageDatasetVersionContentRepository.create({ objectStorage }),
  };
}

async function* bytesOf(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

describe("given an organization's project with datasets stored in object storage", () => {
  async function setup() {
    const { objectStorage, live } = trackedObjectStorage();
    const repositories = repositoriesOver(objectStorage);
    const app = createDatasetTestApp({ repositories });
    const editedBy = { kind: "user", id: "user-1" } as const;

    // A chunked dataset with a saved version, and the same in a project that is not erased.
    for (const projectId of [ERASED, KEPT]) {
      const chunked = await app.upsertDataset({
        projectId,
        name: "Chunked Questions",
        columnTypes,
        datasetRecords: [{ question: "What is LangWatch?" }, { question: "Why?" }],
      });
      await app.saveVersion({ projectId, datasetId: chunked.id, editedBy });
    }
    // The previous release's single-file dataset, archived: archived content is still content.
    const singleFile = await repositories.content.create({
      projectId: ERASED,
      name: "Legacy Questions",
      slug: "legacy-questions",
      columnTypes,
      useS3: true,
      s3RecordCount: 1,
    });
    await repositories.singleFiles.putSingleFile({
      projectId: ERASED,
      datasetId: singleFile.id,
      text: JSON.stringify([{ id: "rec_1", entry: { question: "Where?" } }]),
    });
    await app.archiveDataset({ projectId: ERASED, slugOrId: singleFile.id });
    // An upload staged for a dataset still being normalized.
    const stagingKey = `staging/${ERASED}/upload-1`;
    await objectStorage.write({ projectId: ERASED, key: stagingKey }, bytesOf("question\nHow?"), {
      byteLength: 13,
      contentType: "text/csv",
    });
    await repositories.content.create({
      projectId: ERASED,
      name: "Staged Questions",
      slug: "staged-questions",
      columnTypes,
      status: "processing",
      stagingKey,
    });

    return { app, live };
  }

  const inProject = (live: Set<string>, projectId: string) =>
    [...live].filter((key) => key.includes(`/${projectId}/`) || key.endsWith(`/${projectId}`));

  describe("when the organization's data is erased", () => {
    /** @scenario "Erasing an organization removes its dataset chunks, version chunks and single files" */
    it("removes every chunk, version chunk, single file and staged upload of its projects", async () => {
      const { app, live } = await setup();
      const before = inProject(live, ERASED);
      expect(before.some((key) => key.includes("/versions/"))).toBe(true);
      expect(before.some((key) => key.startsWith("staging/"))).toBe(true);

      await app.eraseStoredContent({ projectIds: [ERASED] });

      expect(inProject(live, ERASED)).toEqual([]);
    });

    it("leaves the datasets of projects outside the erasure untouched", async () => {
      const { app, live } = await setup();
      const kept = inProject(live, KEPT);
      expect(kept.length).toBeGreaterThan(0);

      await app.eraseStoredContent({ projectIds: [ERASED] });

      expect(inProject(live, KEPT)).toEqual(kept);
    });
  });
});
