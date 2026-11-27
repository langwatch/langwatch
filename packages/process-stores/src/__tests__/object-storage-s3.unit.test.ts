import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { NoSuchKey, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { ObjectBodyTooLargeError, StoredObjectNotFoundError } from "../object-storage-backend.ts";
import { bucketRegionOf, s3Backend, s3Client } from "../object-storage-s3.ts";

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

describe("given an S3 account as the deployment configures it", () => {
  describe("when the deployment names a real AWS region", () => {
    /** @scenario "S3 client honors S3_REGION env for real AWS deployments instead of the R2/MinIO 'auto' default" */
    it("hands that region to the client", async () => {
      const client = s3Client({ ...account, region: "eu-central-1" });

      await expect(client.config.region()).resolves.toBe("eu-central-1");
    });
  });

  describe("when access keys reach AWS and no region is named", () => {
    /** @scenario "S3 client never sends the 'auto' region to AWS, even with access keys" */
    it("reads a regional endpoint's region, else leaves it to AWS_REGION, never 'auto'", async () => {
      vi.stubEnv("AWS_REGION", "eu-west-2");
      try {
        const regional = s3Client({
          bucket: "objects",
          endpoint: "https://s3.eu-west-1.amazonaws.com",
          credentials: account.credentials,
        });
        const bare = s3Client({ bucket: "objects", credentials: account.credentials });

        await expect(regional.config.region()).resolves.toBe("eu-west-1");
        await expect(bare.config.region()).resolves.toBe("eu-west-2");
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("when no region is configured for an R2 or MinIO endpoint", () => {
    /** @scenario "S3 client defaults region to 'auto' for R2 and MinIO compatibility" */
    it("hands the client the 'auto' region", async () => {
      for (const endpoint of ["https://example.r2.cloudflarestorage.com", "http://minio:9000"]) {
        const client = s3Client({
          bucket: "objects",
          endpoint,
          credentials: account.credentials,
        });

        await expect(client.config.region()).resolves.toBe("auto");
      }
    });
  });
});

describe("given an AWS bucket and no region named anywhere", () => {
  const bare = { bucket: "objects", credentials: account.credentials };
  const nothingConfigured = async () => undefined;

  describe("when the client first talks to S3", () => {
    /** @scenario "The stored-objects client finds an AWS bucket's region when none is set" */
    it("uses the bucket's own region, for presigned upload URLs too", async () => {
      const askBucket = vi.fn(async () => ({ kind: "found" as const, region: "eu-west-1" }));
      const client = s3Client(bare, { askBucket, configured: nothingConfigured });
      const backend = s3Backend({ client, bucket: "objects", clock });

      await expect(client.config.region()).resolves.toBe("eu-west-1");
      const signed = await backend.signUpload(at, {
        byteLength: 5,
        contentType: "text/csv",
        expiresAt: Temporal.Instant.from("2026-09-24T12:15:00Z"),
      });

      if (signed.kind !== "direct") throw new Error("S3 signs a direct upload URL.");
      const url = new URL(signed.url);
      expect(url.host).toBe("s3.eu-west-1.amazonaws.com");
      expect(url.searchParams.get("X-Amz-Credential")).toContain("/eu-west-1/s3/aws4_request");
      expect(askBucket).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given the client asks AWS where its bucket lives", () => {
  describe("when the question is answered", () => {
    it("closes the client that asked, so its sockets do not outlive the lookup", async () => {
      const destroy = vi.spyOn(S3Client.prototype, "destroy");
      const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({
        BucketRegion: "eu-west-1",
        $metadata: {},
      }));
      try {
        const client = s3Client(
          { bucket: "objects", credentials: account.credentials },
          { configured: async () => undefined },
        );

        await expect(client.config.region()).resolves.toBe("eu-west-1");
        expect(send).toHaveBeenCalledTimes(1);
        expect(destroy).toHaveBeenCalledTimes(1);
      } finally {
        send.mockRestore();
        destroy.mockRestore();
      }
    });
  });
});

describe("given a question about where a bucket lives", () => {
  function answering(answer: () => object) {
    const client = s3Client({ ...account, region: "us-east-1" });
    client.middlewareStack.add(
      () => async () => ({ output: { $metadata: {}, ...answer() }, response: {} }),
      { step: "initialize", name: "scriptedAnswer" },
    );
    return client;
  }

  function refusal(status: number, headers: Record<string, string>) {
    const error = new S3ServiceException({
      name: status === 404 ? "NotFound" : "Forbidden",
      $fault: "client",
      $metadata: { httpStatusCode: status },
      message: "refused",
    });
    Object.assign(error, { $response: { statusCode: status, headers } });
    return () => {
      throw error;
    };
  }

  describe("when AWS answers with the bucket", () => {
    it("reads the region it names", async () => {
      const client = answering(() => ({ BucketRegion: "ap-south-1" }));

      await expect(bucketRegionOf({ client, bucket: "objects" })).resolves.toEqual({
        kind: "found",
        region: "ap-south-1",
      });
    });
  });

  describe("when AWS redirects or refuses but names the region", () => {
    /** @scenario "Region discovery reads the region from a refused answer too" */
    it("reads the region from the answer's header", async () => {
      for (const status of [301, 400, 403]) {
        const client = answering(refusal(status, { "x-amz-bucket-region": "eu-west-1" }));

        await expect(bucketRegionOf({ client, bucket: "objects" })).resolves.toEqual({
          kind: "found",
          region: "eu-west-1",
        });
      }
    });
  });

  describe("when the bucket does not exist", () => {
    /** @scenario "A bucket that does not exist is named, not blamed on the region" */
    it("answers missing", async () => {
      const client = answering(refusal(404, {}));

      await expect(bucketRegionOf({ client, bucket: "objects" })).resolves.toEqual({
        kind: "missing",
      });
    });
  });

  describe("when AWS cannot be reached", () => {
    it("answers unknown, carrying why", async () => {
      const timeout = new Error("connect ETIMEDOUT");
      const client = answering(() => {
        throw timeout;
      });

      await expect(bucketRegionOf({ client, bucket: "objects" })).resolves.toEqual({
        kind: "unknown",
        cause: timeout,
      });
    });
  });

  describe("when AWS refuses and names no region", () => {
    it("answers unknown, carrying the refusal", async () => {
      const client = answering(refusal(403, {}));

      await expect(bucketRegionOf({ client, bucket: "objects" })).resolves.toMatchObject({
        kind: "unknown",
        cause: { name: "Forbidden" },
      });
    });
  });
});

describe("given object storage on S3", () => {
  describe("when a module writes a body", () => {
    /** @scenario "S3 driver handles s3 URIs through the configured S3 client" */
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
