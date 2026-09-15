import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  AbsentPayloadStagingAdapter,
  PayloadStagingUnavailableError,
} from "#services/absent-payload-staging.service";
import { PayloadStagingS3TargetRepository, S3PayloadStagingAdapter } from "#repositories/s3/s3.payload-staging.repository";

function s3(): { client: S3Client; sent: unknown[] } {
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "AKIA-test", secretAccessKey: "secret" },
  });
  const sent: unknown[] = [];
  vi.spyOn(client, "send").mockImplementation((async (command: unknown) => {
    sent.push(command);
    return {};
  }) as never);
  return { client, sent };
}

function targets(client: S3Client): PayloadStagingS3TargetRepository {
  return new (class extends PayloadStagingS3TargetRepository {
    async resolve() {
      return { bucket: "staging-bucket", client };
    }
  })();
}

describe("S3PayloadStagingAdapter", () => {
  describe("given a project with a staging bucket", () => {
    describe("when a payload is staged", () => {
      it("uploads it under the caller's prefix and hands back a presigned GET url", async () => {
        const { client, sent } = s3();
        const adapter = S3PayloadStagingAdapter.create({
          targets: targets(client),
          uniqueSuffix: () => "fixed",
        });

        const staged = await adapter.stage({
          projectId: "project-1",
          keyPrefix: "nlpgo-staging/project-1",
          serialized: Buffer.from("{}"),
          ttlSeconds: 600,
        });

        const put = sent[0] as PutObjectCommand;
        expect(put).toBeInstanceOf(PutObjectCommand);
        expect(put.input.Bucket).toBe("staging-bucket");
        expect(put.input.Key).toBe("nlpgo-staging/project-1/fixed.json");
        expect(staged.url).toContain("staging-bucket");
        expect(staged.url).toContain("nlpgo-staging/project-1/fixed.json");
        expect(staged.url).toContain("X-Amz-Signature=");
      });

      it("deletes the object when the caller discards it", async () => {
        const { client, sent } = s3();
        const adapter = S3PayloadStagingAdapter.create({
          targets: targets(client),
          uniqueSuffix: () => "fixed",
        });

        const staged = await adapter.stage({
          projectId: "project-1",
          keyPrefix: "prefix",
          serialized: Buffer.from("{}"),
          ttlSeconds: 60,
        });
        await staged.discard();

        expect(sent.at(-1)).toBeInstanceOf(DeleteObjectCommand);
      });
    });
  });
});

describe("AbsentPayloadStagingAdapter", () => {
  describe("given a deployment that composed no object storage", () => {
    describe("when a payload needs staging", () => {
      it("refuses by name rather than posting it inline", () => {
        expect(() => AbsentPayloadStagingAdapter.create().stage()).toThrow(
          PayloadStagingUnavailableError,
        );
      });
    });
  });
});
