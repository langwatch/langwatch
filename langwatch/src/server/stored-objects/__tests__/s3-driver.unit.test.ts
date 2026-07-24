/**
 * @vitest-environment node
 *
 * Unit tests for S3Driver — verifies per-method contract using a mocked S3 client.
 */
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectNotFoundError } from "../errors";
import { S3Driver } from "../s3-driver";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("~/server/storage", () => ({
  createS3Client: vi.fn(),
}));

import { createS3Client } from "~/server/storage";

const mockCreateS3Client = vi.mocked(createS3Client);

function makeMockS3Client() {
  return { send: vi.fn() };
}

const TEST_BUCKET = "test-bucket";
const TEST_PROJECT_ID = "proj-123";
const TEST_URI = `s3://${TEST_BUCKET}/proj-123/deadbeef1234`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Asserts the `send` call carried the expected command class and input. */
function assertSentCommand(
  sendMock: ReturnType<typeof vi.fn>,
  commandName: string,
  expectedInput: Record<string, unknown>,
) {
  expect(sendMock).toHaveBeenCalledOnce();
  const [command] = sendMock.mock.calls[0]!;
  expect(command.constructor.name).toBe(commandName);
  expect(command.input).toMatchObject(expectedInput);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S3Driver", () => {
  let s3Client: ReturnType<typeof makeMockS3Client>;
  let driver: S3Driver;

  beforeEach(() => {
    s3Client = makeMockS3Client();
    mockCreateS3Client.mockResolvedValue({
      s3Client: s3Client as any,
      s3Bucket: TEST_BUCKET,
    });
    driver = new S3Driver(TEST_PROJECT_ID);
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe("when get is called with a valid s3 URI", () => {
    describe("and the object exists", () => {
      it("returns the stream from S3", async () => {
        const fakeStream = new Readable({ read() {} });
        s3Client.send.mockResolvedValueOnce({ Body: fakeStream });

        const result = await driver.get(TEST_URI);

        expect(result).toBe(fakeStream);
        assertSentCommand(s3Client.send, "GetObjectCommand", {
          Bucket: TEST_BUCKET,
          Key: "proj-123/deadbeef1234",
        });
      });
    });

    describe("and the object does not exist", () => {
      it("throws ObjectNotFoundError", async () => {
        const noSuchKey = Object.assign(new Error("NoSuchKey"), {
          name: "NoSuchKey",
        });
        s3Client.send.mockRejectedValueOnce(noSuchKey);

        await expect(driver.get(TEST_URI)).rejects.toBeInstanceOf(
          ObjectNotFoundError,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // put
  // -------------------------------------------------------------------------

  describe("when put is called", () => {
    /** @scenario "S3 driver handles s3 URIs through the configured S3 client" */
    it("sends a PutObjectCommand with the URI's bucket and key, the bytes, and the media type", async () => {
      s3Client.send.mockResolvedValueOnce({});
      const bytes = Buffer.from("hello world");
      const mediaType = "application/octet-stream";

      await driver.put(TEST_URI, bytes, mediaType);

      assertSentCommand(s3Client.send, "PutObjectCommand", {
        Bucket: TEST_BUCKET,
        Key: "proj-123/deadbeef1234",
        Body: bytes,
        ContentType: mediaType,
      });
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe("when delete is called", () => {
    it("sends a DeleteObjectCommand", async () => {
      s3Client.send.mockResolvedValueOnce({});

      await driver.delete(TEST_URI);

      assertSentCommand(s3Client.send, "DeleteObjectCommand", {
        Bucket: TEST_BUCKET,
        Key: "proj-123/deadbeef1234",
      });
    });
  });

  // -------------------------------------------------------------------------
  // exists
  // -------------------------------------------------------------------------

  describe("when exists is called", () => {
    describe("and the object exists", () => {
      it("returns true", async () => {
        s3Client.send.mockResolvedValueOnce({});

        const result = await driver.exists(TEST_URI);

        expect(result).toBe(true);
        assertSentCommand(s3Client.send, "HeadObjectCommand", {
          Bucket: TEST_BUCKET,
          Key: "proj-123/deadbeef1234",
        });
      });
    });

    describe("and the object does not exist", () => {
      it("returns false", async () => {
        const notFound = Object.assign(new Error("NotFound"), {
          name: "NotFound",
        });
        s3Client.send.mockRejectedValueOnce(notFound);

        const result = await driver.exists(TEST_URI);

        expect(result).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // non-s3 URI
  // -------------------------------------------------------------------------

  describe("when get is called with a non-s3 URI", () => {
    it("throws", async () => {
      await expect(
        driver.get("file:///var/lib/langwatch/objects/proj/sha"),
      ).rejects.toThrow();
    });
  });
});
