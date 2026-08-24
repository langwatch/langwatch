import { describe, expect, it, vi } from "vitest";
import { datasetSchema, type Dataset } from "@langwatch/dataset-contract";
import { DatasetRecordRepository } from "../src/repositories/dataset-record.repository";
import { DatasetRepository } from "../src/repositories/dataset.repository";
import { DatasetService } from "../src/services/dataset.service";
import { DatasetUploadPort } from "../src/ports/dataset.port";

const row = (): Dataset => datasetSchema.parse({ id: "d1", projectId: "p1", name: "D", slug: "d", columnTypes: [], createdAt: new Date(), updatedAt: new Date(), archivedAt: null, mapping: null, useS3: false, s3RecordCount: null, contentLayout: "postgres", status: "ready", statusError: null, stagingKey: null, uploadFilename: null, rowCount: null, sizeBytes: null, chunkCount: null, chunkOffsets: null });
class Repo extends DatasetRepository {
  tryFindById = vi.fn(async () => row()); tryFindBySlug = vi.fn(async () => row()); list = vi.fn(async () => []); create = vi.fn(async () => row()); update = vi.fn(async () => row()); archive = vi.fn(async () => row()); restore = vi.fn(async () => row()); updateMapping = vi.fn(async () => row()); count = vi.fn(async () => 0);
}
class Records extends DatasetRecordRepository { list = vi.fn(async () => ({ records: [], total: 0 })); createMany = vi.fn(async () => []); update = vi.fn(async () => { throw new Error("unused"); }); deleteMany = vi.fn(async () => 0); }

describe("DatasetService upload boundary", () => {
  it("delegates upload operations to the injected upload port", async () => {
    const uploads = new (class extends DatasetUploadPort {
      uploadToExistingDataset = vi.fn(async () => ({ datasetId: "d1", recordsCreated: 2 }));
      createDatasetFromUpload = vi.fn(async () => ({ id: "d1", name: "D", slug: "d", columnTypes: [], createdAt: new Date(), updatedAt: new Date(), recordsCreated: 2 }));
      createPendingUpload = vi.fn(async () => ({ datasetId: "d1", slug: "d", uploadUrl: "https://example/upload" }));
      writeStagedUpload = vi.fn(async () => undefined); abortPendingUpload = vi.fn(async () => ({ datasetId: "d1", aborted: true as const }));
      finalizeUpload = vi.fn(async () => ({ datasetId: "d1", status: "processing" as const })); retryNormalize = vi.fn(async () => ({ datasetId: "d1", status: "processing" as const }));
    })();
    const service = DatasetService.create({ repository: new Repo(), records: new Records(), uploads });
    await expect(service.createPendingUpload({ projectId: "p1", name: "D", filename: "d.csv" })).resolves.toMatchObject({ datasetId: "d1" });
    expect(uploads.createPendingUpload).toHaveBeenCalledOnce();
  });
});
