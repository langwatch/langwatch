import { describe, expect, it } from "vitest";

import {
  GroupQueueConsumer,
  GroupQueueProducer,
  RunningGroupQueueConsumer,
} from "../capabilities.ts";

function surfaceOf(capability: { prototype: object }): string[] {
  return Object.getOwnPropertyNames(capability.prototype).filter((name) => name !== "constructor");
}

describe("Group Queue capabilities", () => {
  describe("given a producer, a consumer and a running consumer for one definition", () => {
    /** @scenario "Producer and consumer capabilities cannot be confused" */
    it("gives the producer no way to handle work and the consumer no way to stage it", () => {
      const producer = surfaceOf(GroupQueueProducer);
      const consumer = surfaceOf(GroupQueueConsumer);
      const running = surfaceOf(RunningGroupQueueConsumer);

      expect(producer).toContain("send");
      expect(producer).not.toContain("handle");
      expect(producer).not.toContain("handleBatch");

      expect(consumer).toEqual(expect.arrayContaining(["handle", "handleBatch"]));
      for (const staging of ["send", "sendBatch", "registerPreflightGroups"]) {
        expect(consumer).not.toContain(staging);
        expect(running).not.toContain(staging);
      }
    });

    /** @scenario "Producer and consumer capabilities cannot be confused" */
    it("lets a consumer take only a handler, so the definition's decoder and identity rule stay in force", () => {
      const consumer = surfaceOf(GroupQueueConsumer);

      expect(GroupQueueConsumer.prototype.handle.length).toBe(1);
      expect(consumer.toSorted()).toEqual(["handle", "handleBatch", "start"]);
    });
  });
});
