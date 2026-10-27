import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle.ts";
import { createTenantId } from "../storage.ts";
import { contentHash, TieredBlobStore } from "../tieredBlobStore.ts";
import { InMemoryJobBlobStore, InMemoryObjectStore, incompressible } from "./blob-test-doubles.ts";

const PROJECT = createTenantId("project-abc");
const DESTINATION = { vault: "injected-vault" };

function makeStore() {
  const objectStore = new InMemoryObjectStore();
  const mintUri = vi.fn(
    ({
      destination,
      tenantId,
      key,
    }: {
      destination: typeof DESTINATION;
      tenantId: string;
      key: string;
    }) => `vault://${destination.vault}/${tenantId}/${key}`,
  );
  const store = new TieredBlobStore({
    redisBlobs: new InMemoryJobBlobStore(),
    objectStoreFor: () => objectStore,
    resolveDestination: async () => DESTINATION,
    mintUri,
    s3ThresholdBytes: 8,
  });
  return { store, objectStore, mintUri };
}

describe("TieredBlobStore with an injected uri mint", () => {
  describe("given a payload over the durable-tier threshold", () => {
    describe("when it is put", () => {
      /** @scenario "An oversized blob is stored under the uri the injected mint returns" */
      it("stores the bytes under exactly the uri the mint returned", async () => {
        const { store, objectStore, mintUri } = makeStore();
        const data = Buffer.from("this comfortably exceeds the threshold");

        await store.put({ projectId: PROJECT, data });

        expect(mintUri).toHaveBeenCalledOnce();
        const [call] = mintUri.mock.calls[0]!;
        expect(call.destination).toBe(DESTINATION);
        expect(call.tenantId).toBe(PROJECT);
        expect([...objectStore.store.keys()]).toEqual([
          `vault://injected-vault/${PROJECT}/${call.key}`,
        ]);
      });
    });

    describe("when the same bytes are put twice for one tenant", () => {
      /** @scenario "The mint is handed the tenant namespace and the content-addressed key" */
      it("hands the mint the same key both times", async () => {
        const { store, mintUri } = makeStore();
        const data = Buffer.from("identical bytes, identical key");

        await store.put({ projectId: PROJECT, data });
        await store.put({ projectId: PROJECT, data });

        const keys = mintUri.mock.calls.map(([input]) => input.key);
        expect(keys).toEqual([
          `group-queue/${PROJECT}/${contentHash(data)}`,
          `group-queue/${PROJECT}/${contentHash(data)}`,
        ]);
      });
    });
  });
});

describe("EnvelopeBlobLifecycle without a uri minter", () => {
  describe("given a destination resolver and no uri minter", () => {
    describe("when an oversized payload is encoded", () => {
      /** @scenario "A queue configured without a uri minter refuses to offload" */
      it("fails naming the missing storage uri minter", async () => {
        const lifecycle = new EnvelopeBlobLifecycle({
          redis: redisDouble(),
          queueName: "{test/nominter}",
          objectStoreFor: () => new InMemoryObjectStore(),
          resolveStorageDestination: async () => DESTINATION,
        });

        await expect(
          lifecycle.encode({
            jobData: { id: "big", groupId: `${PROJECT}/g1`, value: incompressible(768 * 1024) },
            groupId: `${PROJECT}/g1`,
          }),
        ).rejects.toThrow(/storage uri minter/i);
      });
    });
  });
});
