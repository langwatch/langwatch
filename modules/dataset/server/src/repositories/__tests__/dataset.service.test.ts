import { describe, expect, it } from "vitest";
import { DatasetService } from "../../services/dataset.service.ts";
import type { DatasetRepository } from "../dataset.repository.ts";
import type { DatasetRecordRepository } from "../dataset-record.repository.ts";
import { datasetSchema, type Dataset } from "@langwatch/dataset-contract";

const row = (): Dataset =>
  datasetSchema.parse({
    id: "d1",
    projectId: "p1",
    name: "Golden Set",
    slug: "golden-set",
    columnTypes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    mapping: null,
    useS3: false,
    s3RecordCount: null,
    contentLayout: "postgres",
    status: "ready",
    statusError: null,
    stagingKey: null,
    uploadFilename: null,
    rowCount: null,
    sizeBytes: null,
    chunkCount: null,
    chunkOffsets: null,
  });
class Repo implements DatasetRepository {
  value = row();
  findById = async () => this.value;
  findBySlug = async () => null;
  list = async () => [];
  create = async () => this.value;
  update = async () => this.value;
  archive = async () => this.value;
  restore = async () => this.value;
  updateMapping = async () => this.value;
  count = async () => 0;
}
class Records implements DatasetRecordRepository {
  list = async () => ({ records: [], total: 0 });
  createMany = async () => [];
  update = async () => {
    throw new Error("unused");
  };
  deleteMany = async () => 0;
}

describe("DatasetService", () => {
  it("resolves datasets by the contract boundary", async () => {
    const service = DatasetService.create({
      repository: new Repo(),
      records: new Records(),
    });
    await expect(service.getBySlugOrId({ projectId: "p1", slugOrId: "d1" })).resolves.toMatchObject(
      { id: "d1" },
    );
  });
});
