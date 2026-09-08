/**
 * @vitest-environment node
 */
import { HandledError } from "@langwatch/handled-error";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ApiStoredObjectsConfigResolution } from "../../../platform/config/api.config.ts";
import { describe, expect, it, vi } from "vitest";
import { installApiStoredObject } from "../stored-object.composition.ts";

/** Local filesystem storage and no S3 bucket: nothing to stage a payload in. */
function storageWithoutBucket(): ApiStoredObjectsConfigResolution {
  return {
    backend: undefined,
    localFilesystemRoot: "/tmp/langwatch-payload-staging",
    s3: {},
    azure: {},
    routes: new Map(),
  } as unknown as ApiStoredObjectsConfigResolution;
}

describe("the object store's payload staging port", () => {
  describe("given a process that composed no object storage", () => {
    describe("when a payload needs staging", () => {
      // The port is a REQUIRED collaborator of the NLP and langevals
      // transports, so the absence has to be a refusal by name rather than a
      // silently skipped upload that reappears as a 6 MB Lambda body error.
      it("is composed, and refuses by name rather than being absent", async () => {
        const feature = await installApiStoredObject({
          prisma: { project: { findUnique: vi.fn(async () => null) } } as unknown as PrismaClient,
          resolveClickHouseClient: null,
          clickHouseInstances: null,
          storage: storageWithoutBucket(),
        });

        try {
          const staging = feature.payloadStaging;

          expect(staging).toBeDefined();
          let thrown: unknown;
          try {
            staging.stage({
              projectId: "project-1",
              keyPrefix: "nlpgo-staging/project-1",
              serialized: Buffer.from("{}"),
              ttlSeconds: 60,
            });
          } catch (error) {
            thrown = error;
          }

          expect(thrown).toBeInstanceOf(HandledError);
          expect((thrown as HandledError).code).toBe("service_unavailable");
        } finally {
          await feature.close();
        }
      });
    });
  });
});
