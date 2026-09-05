/**
 * @vitest-environment node
 *
 * The migration driver reads the same addresses the byte driver does, through
 * the same parser. What is proved here is that it refuses another provider's
 * address by name, and that a key reaches S3 as the bytes it was minted from.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sent } = vi.hoisted(() => ({ sent: { send: vi.fn(), destroy: vi.fn() } }));

vi.mock("@aws-sdk/client-s3", async () => {
  const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: class {
      send = sent.send;
      destroy = sent.destroy;
    },
  };
});

import { UnsupportedStorageSchemeError } from "../../errors";
import { MigrationS3StorageDriverAdapter } from "../aws.object-storage-migration.adapter";

const AZURE_URI = "azure-blob://account.blob.core.windows.net/container/proj-123/deadbeef";

function driver() {
  return MigrationS3StorageDriverAdapter.create({
    aws: { build: () => ({}) } as never,
    config: { bucket: "test-bucket", region: "auto" },
  });
}

describe("MigrationS3StorageDriverAdapter", () => {
  beforeEach(() => {
    sent.send = vi.fn();
  });

  describe("given an address belonging to another provider", () => {
    describe("when it reaches the driver's read", () => {
      /** @scenario "The migration driver refuses an Azure address" */
      it("refuses it as an unsupported scheme", async () => {
        const error = await driver()
          .get(AZURE_URI)
          .catch((thrown: unknown) => thrown as UnsupportedStorageSchemeError);

        expect(error).toBeInstanceOf(UnsupportedStorageSchemeError);
        expect(error.expectedScheme).toBe("s3");
        expect(error.scheme).toBe("azure-blob");
      });

      /** @scenario "The migration driver refuses an Azure address" */
      it("never asks S3 for an object", async () => {
        await driver()
          .get(AZURE_URI)
          .catch(() => undefined);

        expect(sent.send).not.toHaveBeenCalled();
      });
    });

    describe("when it reaches the driver's other byte operations", () => {
      /** @scenario "The migration driver refuses an Azure address" */
      it("refuses it on put, delete and exists too", async () => {
        const subject = driver();

        const names = await Promise.all(
          [
            subject.put(AZURE_URI, Buffer.from("x"), "application/octet-stream"),
            subject.delete(AZURE_URI),
            subject.exists(AZURE_URI),
          ].map(async (operation) =>
            operation.then(
              () => "resolved",
              (thrown: Error) => thrown.name,
            ),
          ),
        );

        expect(names).toEqual([
          "UnsupportedStorageSchemeError",
          "UnsupportedStorageSchemeError",
          "UnsupportedStorageSchemeError",
        ]);
        expect(sent.send).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a key holding a character a URL would escape", () => {
    describe("when the driver reads it", () => {
      /** @scenario "Both S3 drivers read one address the same way" */
      it("asks S3 for the key's own bytes, not a percent-encoded rewrite", async () => {
        sent.send.mockResolvedValueOnce({ Body: undefined });

        await driver().get("s3://test-bucket/proj 123/deadbeef");

        const [command] = sent.send.mock.calls[0]!;
        expect(command.input).toMatchObject({
          Bucket: "test-bucket",
          Key: "proj 123/deadbeef",
        });
      });
    });
  });
});
