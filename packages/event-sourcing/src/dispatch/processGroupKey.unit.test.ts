import { describe, expect, it } from "vitest";
import { parseGroupKey, renderGroupKey } from "../dispatch/groupKey";
import { processGroupKey } from "./processGroupKey";

/**
 * `processGroupKey` is the one place a pipeline derives a process instance's
 * lane, so it never hand-rolls the descriptor ADR-100 replaced string
 * concatenation with.
 */
describe("processGroupKey", () => {
  describe("given a built process and a caller-supplied process key", () => {
    const process = { name: "triggerSettlement" } as const;

    it("places one lane per process instance, scoped by the process's own name and the caller's process key", () => {
      const key = processGroupKey(process, {
        tenantId: "tenant-1",
        processKey: "trigger-1",
      });

      expect(key).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "processManager", name: "triggerSettlement" },
        scope: {
          kind: "aggregate",
          aggregateType: "triggerSettlement",
          aggregateId: "trigger-1",
        },
      });
    });

    /** @scenario a key can be read back to say which tenant, lane and scope it names */
    it("round-trips through the renderer back to the same descriptor", () => {
      const key = processGroupKey(process, {
        tenantId: "tenant-1",
        processKey: "trigger-1",
      });

      expect(parseGroupKey(renderGroupKey(key))).toEqual(key);
    });
  });
});
