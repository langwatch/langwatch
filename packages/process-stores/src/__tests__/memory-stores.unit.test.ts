import { describe, expect, it } from "vitest";

import { memoryStores } from "../memory-stores.ts";

describe("given the memory stores of a process", () => {
  describe("when eventing and a module's memory repositories each ask for the process store", () => {
    /** @scenario "The memory stores hold one process store for every reader" */
    it("answers both with the same instance", () => {
      const stores = memoryStores();

      expect(stores.order).toContain("processStore");
      expect(stores.read("processStore")).toBe(stores.processStore);
    });
  });
});
