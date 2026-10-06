import { describe, expect, it } from "vitest";

import { InMemoryProcessStore } from "../inMemoryProcessStore.ts";

describe("InMemoryProcessStore appending with a caller's transaction", () => {
  describe("when a caller passes its transaction", () => {
    /** @scenario "The in-memory store appends a caller's intents at once" */
    it("holds the intent pending, since there is no transaction to join", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const ref = { processName: "audit", projectId: "project-1", processKey: "audit" };

      const result = await store.appendIntents({
        ref,
        tenantId: "project-1",
        sourceEventId: null,
        messages: [
          { messageKey: "intent-1", intentType: "recordAudit", payload: {}, traceCarrier: {} },
        ],
        now: 1_000,
        transaction: { kind: "memory" },
      });

      expect(result.insertedMessageKeys).toEqual(["intent-1"]);
      const rows = await store.findMessagesByRef({ ref });
      expect(rows.map((row) => [row.messageKey, row.status])).toEqual([["intent-1", "pending"]]);
    });
  });
});
