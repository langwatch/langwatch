import { describe, expect, it } from "vitest";
import { LocalDatasetStorage } from "../local.dataset-storage.adapter";

describe("Dataset self-hosted storage", () => {
  it("keeps local storage injectable with same-origin staging", async () => {
    const storage = new LocalDatasetStorage("/tmp/langwatch-dataset-test");
    await expect(
      storage.createPresignedUpload({ projectId: "p1" }),
    ).resolves.toMatchObject({
      url: expect.stringContaining("/api/dataset/direct-upload/staging/"),
    });
  });
});
