import { memoryObjectStorage } from "@langwatch/process-stores";
import type { ObjectStorage } from "@langwatch/process-stores/members";
import { describe, expect, it } from "vitest";

import { ObjectStorageLangevalsPayloadStaging } from "../object-storage.langevals-payload-staging.channel.ts";

const PREFIX = "langevals-staging/project_1/evaluation";

async function textAt(url: string, objects = memoryObjectStorage()): Promise<string> {
  const key = decodeURIComponent(new URL(url).pathname).replace(/^\/project_1\//u, "");
  const chunks: Uint8Array[] = [];
  for await (const chunk of await objects.read({ projectId: "project_1", key })) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

describe("ObjectStorageLangevalsPayloadStaging", () => {
  describe("when a payload is staged", () => {
    /** @scenario "A staged payload is parked in the project's object storage behind a signed download" */
    it("parks the body under the prefix and answers a signed download", async () => {
      const objects = memoryObjectStorage();
      const staging = ObjectStorageLangevalsPayloadStaging.create({ objectStorage: objects });

      const staged = await staging.stage({
        projectId: "project_1",
        keyPrefix: PREFIX,
        serialized: Buffer.from('{"data":[]}'),
        ttlSeconds: 600,
      });

      expect(staged.url).toContain(`${PREFIX}/`);
      expect(new URL(staged.url).searchParams.get("expires")).not.toBeNull();
      expect(await textAt(staged.url, objects)).toBe('{"data":[]}');
    });

    /** @scenario "Discarding a staged payload removes it from object storage" */
    it("removes the parked body on discard", async () => {
      const objects = memoryObjectStorage();
      const staging = ObjectStorageLangevalsPayloadStaging.create({ objectStorage: objects });
      const staged = await staging.stage({
        projectId: "project_1",
        keyPrefix: PREFIX,
        serialized: Buffer.from("{}"),
        ttlSeconds: 60,
      });

      await staged.discard();

      await expect(textAt(staged.url, objects)).rejects.toMatchObject({
        name: "StoredObjectNotFoundError",
      });
    });
  });

  describe("when the caller has already aborted", () => {
    /** @scenario "A staging call aborted by its caller writes nothing" */
    it("rejects with the abort before writing", async () => {
      const objects = memoryObjectStorage();
      const written: string[] = [];
      const recording: ObjectStorage = {
        ...objects,
        write: (at, body, facts) => {
          written.push(at.key);
          return objects.write(at, body, facts);
        },
      };
      const staging = ObjectStorageLangevalsPayloadStaging.create({ objectStorage: recording });
      const controller = new AbortController();
      controller.abort(new Error("deadline"));

      await expect(
        staging.stage({
          projectId: "project_1",
          keyPrefix: PREFIX,
          serialized: Buffer.from("{}"),
          ttlSeconds: 60,
          signal: controller.signal,
        }),
      ).rejects.toThrow("deadline");
      expect(written).toEqual([]);
    });
  });
});
