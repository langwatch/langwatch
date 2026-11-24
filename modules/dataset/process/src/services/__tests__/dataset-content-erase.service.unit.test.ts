/**
 * @vitest-environment node
 * An erasure that stops part way must leave a record of which datasets it already stripped.
 * @see specs/datasets/storage-object-only/other-postgres-copies.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { DatasetContentEraseService } from "../dataset-content-erase.service.ts";

const PROJECT = "project-erased";
const columnTypes = [{ name: "question", type: "string" as const }];

describe("given a project with a dataset holding a staged upload", () => {
  async function setup() {
    const repositories = MemoryDatasetRepositories.create();
    const dataset = await repositories.content.create({
      projectId: PROJECT,
      name: "Staged Questions",
      slug: "staged-questions",
      columnTypes,
      contentLayout: "s3_jsonl",
      status: "processing",
      stagingKey: `staging/${PROJECT}/upload-1`,
    });
    const { logger, lines } = createTestLogger();
    const service = DatasetContentEraseService.create({
      datasets: repositories.datasets,
      chunks: repositories.chunks,
      versions: repositories.versions,
      versionContent: repositories.versionContent,
      singleFiles: repositories.singleFiles,
      logger,
    });
    return { service, lines, datasetId: dataset.id };
  }

  describe("when its stored content is erased", () => {
    /** @scenario "An erasure logs each dataset whose objects it removed" */
    it("logs one line naming the dataset and what was removed", async () => {
      const { service, lines, datasetId } = await setup();

      await service.eraseStoredContent({ projectIds: [PROJECT] });

      expect(lines.findLine("info", "Erased a dataset's stored content")).toMatchObject({
        projectId: PROJECT,
        datasetId,
        versions: 0,
        stagedUpload: true,
      });
    });
  });
});
