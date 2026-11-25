/**
 * @vitest-environment node
 * @see specs/studio/rename-code-blocks.feature
 */
import { findLowestAvailableName, nameToId } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

describe("given a workflow that already holds a named code block", () => {
  describe("when the block is duplicated", () => {
    /** @scenario "Duplicate code block gets unique name" */
    it("suffixes the duplicate's name so its node id does not collide", () => {
      const existing = [nameToId("Data Processor")];

      const duplicate = findLowestAvailableName(existing, "Data Processor");

      expect(duplicate.name).toBe("Data Processor (2)");
      expect(existing).not.toContain(duplicate.id);

      const second = findLowestAvailableName([...existing, duplicate.id], "Data Processor");
      expect(second.name).toBe("Data Processor (3)");
    });
  });
});
