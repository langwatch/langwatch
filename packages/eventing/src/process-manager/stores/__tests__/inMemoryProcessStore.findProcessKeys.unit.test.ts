import { describe, expect, it } from "vitest";

import type { ProcessRef } from "../../processManager.types.ts";
import { InMemoryProcessStore } from "../inMemoryProcessStore.ts";

function ref(processKey: string, projectId: string, processName = "ingestionPull"): ProcessRef {
  return { processName, projectId, processKey };
}

async function seed(store: InMemoryProcessStore, target: ProcessRef): Promise<void> {
  await store.commit({
    ref: target,
    tenantId: target.projectId,
    sourceEventId: `event-${target.processKey}`,
    expectedRevision: 0,
    state: {},
    nextWakeAt: null,
    messages: [],
    now: 1_000,
  });
}

describe("InMemoryProcessStore.findProcessKeys", () => {
  describe("given instances of several processes across projects", () => {
    it("returns only the named process's keys within the named projects", async () => {
      const store = InMemoryProcessStore.createForTesting();
      await seed(store, ref("source-1", "project-1"));
      await seed(store, ref("source-2", "project-2"));
      await seed(store, ref("source-3", "project-3"));
      await seed(store, ref("other-1", "project-1", "otherProcess"));

      const keys = await store.findProcessKeys({
        processName: "ingestionPull",
        projectIds: ["project-1", "project-2"],
      });

      expect(keys.toSorted()).toEqual(["source-1", "source-2"]);
    });

    it("returns an empty list when no project is named", async () => {
      const store = InMemoryProcessStore.createForTesting();
      await seed(store, ref("source-1", "project-1"));

      expect(await store.findProcessKeys({ processName: "ingestionPull", projectIds: [] })).toEqual(
        [],
      );
    });
  });
});
