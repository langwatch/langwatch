/**
 * @vitest-environment jsdom
 */
import type {
  StoredObjectReference,
  StoredObjectsCreateUploadOutput,
} from "@langwatch/stored-object-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PresignedUploadFailedError,
  putFileToUploadUrl,
  type StoredObjectUploadTransport,
  uploadStoredObject,
} from "../stored-object-upload.ts";

const mockFetch = () => global.fetch as ReturnType<typeof vi.fn>;

const upload = (
  overrides: Partial<StoredObjectsCreateUploadOutput> = {},
): StoredObjectsCreateUploadOutput => ({
  objectId: "so_1",
  uploadUrl: "https://s3.example/put",
  method: "PUT",
  headers: { "content-type": "text/csv" },
  expiresAt: "2030-01-01T00:00:00.000Z",
  ...overrides,
});

const localUpload = () =>
  upload({ uploadUrl: "/api/stored-objects/uploads/so_1/content?sig=abc", headers: undefined });

const reference: StoredObjectReference = {
  projectId: "p1",
  id: "so_1",
  sha256: "a".repeat(64),
  byteLength: 8,
  filename: "data.csv",
  mediaType: "text/csv",
  audience: "datasets:view",
};

const csv = () => new File(["a,b\n1,2\n"], "data.csv", { type: "text/csv" });

describe("stored-object upload", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("uploadStoredObject()", () => {
    describe("when the file is sent", () => {
      it("creates the upload, PUTs the raw file, then confirms it", async () => {
        mockFetch().mockResolvedValue({ ok: true });
        const transport = {
          createUpload: vi
            .fn<StoredObjectUploadTransport["createUpload"]>()
            .mockResolvedValue(upload()),
          confirmUpload: vi
            .fn<StoredObjectUploadTransport["confirmUpload"]>()
            .mockResolvedValue(reference),
        };
        const file = csv();

        const result = await uploadStoredObject({
          projectId: "p1",
          purpose: "dataset_import",
          file,
          transport,
        });

        expect(transport.createUpload).toHaveBeenCalledWith({
          projectId: "p1",
          purpose: "dataset_import",
          filename: "data.csv",
          mediaType: "text/csv",
          byteLength: file.size,
        });
        expect(mockFetch().mock.calls[0]![1].body).toBe(file);
        expect(transport.confirmUpload).toHaveBeenCalledWith({ projectId: "p1", objectId: "so_1" });
        expect(result).toBe(reference);
      });
    });
  });

  describe("putFileToUploadUrl()", () => {
    describe("when the storage PUT succeeds", () => {
      it("PUTs the raw file with the signed headers and no credentials", async () => {
        mockFetch().mockResolvedValue({ ok: true });
        const file = csv();

        await putFileToUploadUrl({ upload: upload(), file });

        const [url, init] = mockFetch().mock.calls[0]!;
        expect(url).toBe("https://s3.example/put");
        expect(init.method).toBe("PUT");
        expect(init.body).toBe(file);
        expect(init.credentials).toBe("omit");
        expect(init.headers).toEqual({ "content-type": "text/csv" });
      });
    });

    describe("when the storage PUT returns a non-ok status", () => {
      it("throws PresignedUploadFailedError with the status", async () => {
        mockFetch().mockResolvedValue({ ok: false, status: 403 });

        const err = await putFileToUploadUrl({ upload: upload(), file: csv() }).catch(
          (e: unknown) => e,
        );

        expect(err).toBeInstanceOf(PresignedUploadFailedError);
        expect((err as Error).message).toMatch(/status 403/);
      });
    });

    describe("when the storage PUT fails with a network or CORS error", () => {
      it("wraps the opaque fetch rejection in PresignedUploadFailedError", async () => {
        mockFetch().mockRejectedValue(new TypeError("Failed to fetch"));

        await expect(putFileToUploadUrl({ upload: upload(), file: csv() })).rejects.toBeInstanceOf(
          PresignedUploadFailedError,
        );
      });
    });

    describe("when the PUT is cancelled", () => {
      it("rethrows the abort as it is", async () => {
        const abort = new Error("aborted");
        abort.name = "AbortError";
        mockFetch().mockRejectedValue(abort);

        await expect(putFileToUploadUrl({ upload: upload(), file: csv() })).rejects.toBe(abort);
      });
    });

    describe("when the same-origin signed route refuses", () => {
      it("carries the handled code and does not signal a fallback", async () => {
        mockFetch().mockResolvedValue({
          ok: false,
          status: 413,
          json: () => Promise.resolve({ error: "upload_too_large", message: "Too large" }),
        });

        const err = await putFileToUploadUrl({ upload: localUpload(), file: csv() }).catch(
          (e: unknown) => e,
        );

        expect(err).not.toBeInstanceOf(PresignedUploadFailedError);
        expect(err).toMatchObject({ error: "upload_too_large", status: 413 });
      });

      it("surfaces a fetch rejection directly rather than as a CORS fallback", async () => {
        mockFetch().mockRejectedValue(new TypeError("network down"));

        const err = await putFileToUploadUrl({ upload: localUpload(), file: csv() }).catch(
          (e: unknown) => e,
        );

        expect(err).not.toBeInstanceOf(PresignedUploadFailedError);
        expect((err as Error).message).toMatch(/network down/);
      });
    });
  });
});
