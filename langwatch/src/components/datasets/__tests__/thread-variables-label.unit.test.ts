/**
 * @vitest-environment node
 *
 * Unit test for DatasetMappingPreview tab label.
 * Feature: specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature
 *
 * Verifies the tab label reads "Thread" not "Threads" by checking the source code.
 * We use a source-code assertion approach because rendering DatasetMappingPreview
 * requires extensive mocking of ag-grid, tRPC, and Chakra which is disproportionate
 * for a simple label check.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Feature: Thread variables available in trace-level evaluator input mapping", () => {
  // -------------------------------------------------------------------------
  // @unit Scenario: DatasetMappingPreview tab label reads "Thread" not "Threads"
  // -------------------------------------------------------------------------
  describe("DatasetMappingPreview", () => {
    describe("when the user views the mapping toggle tabs", () => {
      it("uses 'Thread' as the thread tab label (not 'Threads')", () => {
        const sourceCode = readFileSync(
          resolve(
            __dirname,
            "../DatasetMappingPreview.tsx",
          ),
          "utf-8",
        );

        // The thread tab button should contain <Text>Thread</Text>
        // and NOT <Text>Threads</Text>
        expect(sourceCode).toContain("<Text>Thread</Text>");
        expect(sourceCode).not.toContain("<Text>Threads</Text>");
      });
    });
  });
});
