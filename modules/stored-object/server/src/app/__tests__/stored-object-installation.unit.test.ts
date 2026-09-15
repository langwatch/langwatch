/**
 * @vitest-environment node
 * @see modules/stored-object/specs/stored-objects.feature
 */
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import { StoredObjectApi, StoredObjectNotFoundError } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import { storedObjectServer } from "../../stored-object.server.ts";
import { createStoredObjectTestInfrastructure } from "./stored-object.fixture.ts";

function installation() {
  return createApp({ role: "api", config: {} })
    .withInfrastructure(createStoredObjectTestInfrastructure())
    .withModules([withMemoryRepositories(storedObjectServer)]);
}

const bytes = {
  projectId: "project_1",
  filename: "input.bin",
  mediaType: "application/octet-stream",
  audience: "project:view",
  purpose: "test",
  ownerKind: "test",
  ownerId: "owner-1",
  bytes: new Uint8Array([1, 2, 3]),
} as const;

describe("stored-object app installation", () => {
  describe("given a process that installs the feature over the memory backend", () => {
    /** @scenario "A process boots the Stored Objects feature over either backend" */
    it.each(["api", "worker", "task"] as const)(
      "installs a working app in the %s role",
      async (role) => {
        const runtime = await installation().boot();

        try {
          const app = runtime.service(StoredObjectApi);

          expect(runtime.module(storedObjectServer).provided).toBe(app);

          const stored = await app.storeFromBytes(bytes);

          await expect(
            app.getMetadata({ projectId: bytes.projectId, id: stored.reference.id }),
          ).resolves.toMatchObject({ id: stored.reference.id, status: "available" });

          await expect(
            app.getMetadata({ projectId: "other-project", id: stored.reference.id }),
          ).rejects.toBeInstanceOf(StoredObjectNotFoundError);
        } finally {
          await runtime.stop();
        }
      },
    );

    /** @scenario "A process boots the Stored Objects feature over either backend" */
    it("allocates independent memory repositories for each installation", async () => {
      const first = await installation().boot();
      const second = await installation().boot();

      try {
        const stored = await first.service(StoredObjectApi).storeFromBytes(bytes);

        await expect(
          second
            .service(StoredObjectApi)
            .getMetadata({ projectId: bytes.projectId, id: stored.reference.id }),
        ).rejects.toBeInstanceOf(StoredObjectNotFoundError);
      } finally {
        await Promise.all([first.stop(), second.stop()]);
      }
    });
  });
});
