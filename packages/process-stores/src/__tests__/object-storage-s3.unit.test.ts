import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { NoSuchKey } from "@aws-sdk/client-s3";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ObjectBodyTooLargeError, StoredObjectNotFoundError } from "../object-storage-backend.ts";
import { s3Backend, s3Client } from "../object-storage-s3.ts";

const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
const at = { projectId: "project-1", key: "project-1/object-1" };
const account = {
  bucket: "objects",
  region: "eu-west-1",
  credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" },
};

async function* text(value: string): AsyncGenerator<Uint8Array> {
  yield Buffer.from(value);
}

/** An S3 client whose requests stop at the SDK's first step, answering what the test scripts. */
function scriptedClient(answer: (command: string, input: object) => Promise<object>) {
  const client = s3Client(account);
  const sent: { command: string; input: object }[] = [];
  client.middlewareStack.add(
    (_next, context) => async (args) => {
      const command = context.commandName ?? "";
      sent.push({ command, input: args.input });
      if ("Body" in args.input && args.input.Body instanceof Readable) {
        for await (const _chunk of args.input.Body) void _chunk;
      }
      return { output: { $metadata: {}, ...(await answer(command, args.input)) }, response: {} };
    },
    { step: "initialize", name: "scriptedAnswer" },
  );
  return { client, sent };
}

describe("given object storage on S3", () => {
  describe("when a module writes a body", () => {
    it("streams it with its declared length and type, and answers its digest", async () => {
      const { client, sent } = scriptedClient(() => Promise.resolve({}));
      const backend = s3Backend({ client, bucket: "objects", clock });

      const written = await backend.write(at, text("hello"), {
        byteLength: 5,
        contentType: "text/plain",
      });

      expect(written).toEqual({
        byteLength: 5,
        sha256: createHash("sha256").update("hello").digest("hex"),
      });
      expect(sent[0]).toMatchObject({
        command: "PutObjectCommand",
        input: { Bucket: "objects", Key: at.key, ContentLength: 5, ContentType: "text/plain" },
      });
    });

    it("refuses a body longer than declared", async () => {
      const { client } = scriptedClient(() => Promise.resolve({}));
      const backend = s3Backend({ client, bucket: "objects", clock });

      await expect(
        backend.write(at, text("hello!"), { byteLength: 5, contentType: "text/plain" }),
      ).rejects.toBeInstanceOf(ObjectBodyTooLargeError);
    });
  });

  describe("when S3 holds the object's full SHA-256", () => {
    it("answers it from the object's head without reading the body", async () => {
      const sha256 = createHash("sha256").update("hello");
      const { client, sent } = scriptedClient(() =>
        Promise.resolve({
          ChecksumSHA256: sha256.copy().digest("base64"),
          ChecksumType: "FULL_OBJECT",
          ContentLength: 5,
        }),
      );
      const backend = s3Backend({ client, bucket: "objects", clock });

      await expect(backend.digest(at)).resolves.toEqual({
        byteLength: 5,
        sha256: sha256.digest("hex"),
      });
      expect(sent.map((request) => request.command)).toEqual(["HeadObjectCommand"]);
    });
  });

  describe("when the object is absent", () => {
    it("refuses the read with StoredObjectNotFoundError", async () => {
      const { client } = scriptedClient(() =>
        Promise.reject(new NoSuchKey({ message: "absent", $metadata: { httpStatusCode: 404 } })),
      );
      const backend = s3Backend({ client, bucket: "objects", clock });

      await expect(backend.read(at)).rejects.toBeInstanceOf(StoredObjectNotFoundError);
    });
  });

  describe("when an upload URL is signed", () => {
    /** @scenario "An S3 upload URL is signed over the content type and length" */
    it("signs content-type and content-length, and carries no checksum", async () => {
      const backend = s3Backend({ client: s3Client(account), bucket: "objects", clock });

      const signed = await backend.signUpload(at, {
        byteLength: 5,
        contentType: "text/csv",
        expiresAt: Temporal.Instant.from("2026-09-24T12:15:00Z"),
      });

      if (signed.kind !== "direct") throw new Error("S3 signs a direct upload URL.");
      const url = new URL(signed.url);
      expect(url.pathname).toBe(`/objects/${at.key}`);
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
      expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
      expect([...url.searchParams.keys()].filter((name) => /checksum/i.test(name))).toEqual([]);
      expect(signed.headers).toEqual({ "content-type": "text/csv" });
    });

    it("refuses to sign an upload URL that has already expired", async () => {
      const backend = s3Backend({ client: s3Client(account), bucket: "objects", clock });

      await expect(
        backend.signUpload(at, {
          byteLength: 5,
          contentType: "text/csv",
          expiresAt: Temporal.Instant.from("2026-09-24T11:59:00Z"),
        }),
      ).rejects.toThrow(RangeError);
    });
  });

  describe("when a download URL is signed", () => {
    /** @scenario "An S3 download URL is a presigned GET that lapses when asked" */
    it("presigns a GET for the one key, lapsing when asked", async () => {
      const backend = s3Backend({ client: s3Client(account), bucket: "objects", clock });

      const url = new URL(
        await backend.signDownload(at, {
          expiresAt: Temporal.Instant.from("2026-09-24T12:15:00Z"),
        }),
      );

      expect(url.pathname).toBe(`/objects/${at.key}`);
      expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
      expect(url.searchParams.get("x-id")).toBe("GetObject");
    });

    it("refuses to sign a download URL that has already expired", async () => {
      const backend = s3Backend({ client: s3Client(account), bucket: "objects", clock });

      await expect(
        backend.signDownload(at, { expiresAt: Temporal.Instant.from("2026-09-24T11:59:00Z") }),
      ).rejects.toThrow(RangeError);
    });
  });
});
