/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortPendingUpload,
  DatasetNameConflictError,
  DirectUploadUnavailableError,
  finalizeDirectUpload,
  PresignedUploadFailedError,
  putFileToPresignedUrl,
  requestDirectUpload,
  retryDatasetNormalize,
} from "../directUpload";

const mockFetch = () => global.fetch as ReturnType<typeof vi.fn>;

describe("directUpload service", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("requestDirectUpload()", () => {
    describe("when the backend returns a presigned upload", () => {
      it("posts FormData and returns the upload handle", async () => {
        const handle = {
          datasetId: "dataset_1",
          slug: "my-dataset",
          uploadUrl: "https://s3.example/staging/abc",
          stagingKey: "staging/proj/abc",
        };
        mockFetch().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(handle),
        });

        const result = await requestDirectUpload({
          projectId: "proj_1",
          name: "My Dataset",
          filename: "data.csv",
        });

        expect(result).toEqual(handle);
        const [url, init] = mockFetch().mock.calls[0]!;
        expect(url).toBe("/api/dataset/direct-upload");
        expect(init.method).toBe("POST");
        const form = init.body as FormData;
        expect(form.get("projectId")).toBe("proj_1");
        expect(form.get("name")).toBe("My Dataset");
        expect(form.get("filename")).toBe("data.csv");
      });
    });

    describe("when object storage is unavailable (409 DirectUploadUnavailable)", () => {
      it("throws DirectUploadUnavailableError so the caller falls back", async () => {
        mockFetch().mockResolvedValue({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({
              error: "DirectUploadUnavailable",
              message: "no storage",
            }),
        });

        await expect(
          requestDirectUpload({
            projectId: "proj_1",
            name: "X",
            filename: "x.csv",
          }),
        ).rejects.toBeInstanceOf(DirectUploadUnavailableError);
      });
    });

    describe("when the dataset name conflicts (409 Conflict)", () => {
      it("throws DatasetNameConflictError", async () => {
        mockFetch().mockResolvedValue({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({ error: "Conflict", message: "name taken" }),
        });

        await expect(
          requestDirectUpload({
            projectId: "proj_1",
            name: "X",
            filename: "x.csv",
          }),
        ).rejects.toBeInstanceOf(DatasetNameConflictError);
      });
    });

    describe("when the backend returns another error", () => {
      it("throws a generic Error with the body message", async () => {
        mockFetch().mockResolvedValue({
          ok: false,
          status: 422,
          json: () => Promise.resolve({ error: "Unprocessable Entity" }),
        });

        await expect(
          requestDirectUpload({
            projectId: "proj_1",
            name: "X",
            filename: "x.csv",
          }),
        ).rejects.toThrow("Unprocessable Entity");
      });
    });
  });

  describe("putFileToPresignedUrl()", () => {
    describe("when the storage PUT succeeds", () => {
      it("PUTs the raw file with no credentials and no Content-Type header", async () => {
        mockFetch().mockResolvedValue({ ok: true });
        const file = new File(["a,b\n1,2\n"], "data.csv", {
          type: "text/csv",
        });

        await putFileToPresignedUrl("https://s3.example/put", file);

        const [url, init] = mockFetch().mock.calls[0]!;
        expect(url).toBe("https://s3.example/put");
        expect(init.method).toBe("PUT");
        expect(init.body).toBe(file);
        // No credentials on the cross-origin presigned PUT.
        expect(init.credentials).toBe("omit");
        // No Content-Type header: createPresignedUpload signs the PUT without
        // one, so adding it here would break the signature.
        expect(init.headers).toBeUndefined();
      });
    });

    describe("when the storage PUT returns a non-ok status", () => {
      it("throws PresignedUploadFailedError with the status", async () => {
        mockFetch().mockResolvedValue({ ok: false, status: 403 });
        const file = new File(["x"], "data.csv");

        await expect(
          putFileToPresignedUrl("https://s3.example/put", file),
        ).rejects.toBeInstanceOf(PresignedUploadFailedError);
        mockFetch().mockResolvedValue({ ok: false, status: 403 });
        await expect(
          putFileToPresignedUrl("https://s3.example/put", file),
        ).rejects.toThrow(/status 403/);
      });
    });

    describe("when the storage PUT fails with a network/CORS error", () => {
      it("wraps the opaque fetch rejection in PresignedUploadFailedError", async () => {
        // A bucket with no CORS rule rejects fetch with an opaque TypeError —
        // no status to read. It must surface as the typed fallback error.
        const cause = new TypeError("Failed to fetch");
        mockFetch().mockRejectedValue(cause);
        const file = new File(["x"], "data.csv");

        await expect(
          putFileToPresignedUrl("https://s3.example/put", file),
        ).rejects.toBeInstanceOf(PresignedUploadFailedError);
      });
    });
  });

  describe("abortPendingUpload()", () => {
    describe("when cleaning up a pending upload", () => {
      it("DELETEs the direct-upload route with the projectId", async () => {
        mockFetch().mockResolvedValue({ ok: true });

        await abortPendingUpload({
          projectId: "proj_1",
          datasetId: "dataset_1",
        });

        const [url, init] = mockFetch().mock.calls[0]!;
        expect(url).toBe(
          "/api/dataset/direct-upload/dataset_1?projectId=proj_1",
        );
        expect(init.method).toBe("DELETE");
      });
    });
  });

  describe("finalizeDirectUpload()", () => {
    describe("when finalize succeeds", () => {
      it("POSTs to the finalize route with projectId and returns the status", async () => {
        mockFetch().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({ datasetId: "dataset_1", status: "processing" }),
        });

        const result = await finalizeDirectUpload({
          projectId: "proj_1",
          datasetId: "dataset_1",
        });

        expect(result).toEqual({
          datasetId: "dataset_1",
          status: "processing",
        });
        const [url, init] = mockFetch().mock.calls[0]!;
        expect(url).toBe(
          "/api/dataset/direct-upload/dataset_1/finalize?projectId=proj_1",
        );
        expect(init.method).toBe("POST");
      });
    });

    describe("when finalize fails", () => {
      it("throws with the body error", async () => {
        mockFetch().mockResolvedValue({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: "Conflict" }),
        });

        await expect(
          finalizeDirectUpload({ projectId: "proj_1", datasetId: "dataset_1" }),
        ).rejects.toThrow("Conflict");
      });
    });
  });

  describe("retryDatasetNormalize()", () => {
    describe("when retry succeeds", () => {
      it("POSTs to the retry route with projectId and returns the status", async () => {
        mockFetch().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({ datasetId: "dataset_1", status: "processing" }),
        });

        const result = await retryDatasetNormalize({
          projectId: "proj_1",
          datasetId: "dataset_1",
        });

        expect(result).toEqual({
          datasetId: "dataset_1",
          status: "processing",
        });
        const [url, init] = mockFetch().mock.calls[0]!;
        expect(url).toBe(
          "/api/dataset/direct-upload/dataset_1/retry?projectId=proj_1",
        );
        expect(init.method).toBe("POST");
      });
    });
  });
});
