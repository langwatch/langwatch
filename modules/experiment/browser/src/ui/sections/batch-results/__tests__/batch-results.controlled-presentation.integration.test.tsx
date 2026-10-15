import "@testing-library/jest-dom/vitest";
/**
 * @vitest-environment jsdom
 * The result tables are controlled by the values and ports they are handed; the screen above
 * them owns routing, queries and drawers.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCsvHeaders, generateCsvContent } from "../../batch-evaluation-results.csv.ts";
import type { BatchEvaluationData } from "../../batch-evaluation-results.types.ts";
import { BatchEvaluationResultsTable } from "../batch-evaluation-results-table.tsx";

const SECTIONS = join(import.meta.dirname, "..", "..");

const data: BatchEvaluationData = {
  runId: "run-1",
  experimentId: "exp-1",
  projectId: "proj-1",
  createdAt: 1705320000000,
  datasetColumns: [{ name: "input", hasImages: false }],
  targetColumns: [
    { id: "target-1", name: "gpt-5-mini", type: "prompt", outputFields: ["response"] },
  ],
  evaluatorIds: [],
  evaluatorNames: {},
  comparisonColumns: [],
  rows: [
    {
      index: 0,
      datasetEntry: { input: "What is 2+2?" },
      targets: {
        "target-1": {
          targetId: "target-1",
          output: null,
          cost: null,
          duration: null,
          error: "provider_error",
          traceId: null,
          evaluatorResults: [],
        },
      },
    },
  ],
};

function importsOf(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(
      (line) => /^\s*(import|\} from)\b/.test(line) || /\buse(Router|Drawer|Query)\b/.test(line),
    )
    .join("\n");
}

afterEach(cleanup);

describe("batch results presentation", () => {
  describe("when the app has loaded experiment run values and renders batch results", () => {
    /** @scenario "Batch-result presentation remains controlled and portable" */
    it("renders the table from the values and the failure wording the caller supplies", () => {
      const describeFailure = vi.fn(() => ({
        title: "Supplied failure title",
        description: "Supplied failure description",
      }));

      renderWithDesignSystem(
        <BatchEvaluationResultsTable
          data={data}
          describeFailure={describeFailure}
          disableVirtualization
        />,
      );

      expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
      expect(describeFailure).toHaveBeenCalledWith({
        error: "provider_error",
        domainError: undefined,
      });
      expect(screen.getByText("Supplied failure title")).toBeInTheDocument();
    });

    /** @scenario "Batch-result presentation remains controlled and portable" */
    it("exports the same controlled values as CSV", () => {
      expect(buildCsvHeaders(data)).toContain("input");
      expect(generateCsvContent(data)).toContain("What is 2+2?");
    });

    /** @scenario "Batch-result presentation remains controlled and portable" */
    it("keeps routing, queries and drawer opening out of the controlled tables and in the screen", () => {
      const controlled = readdirSync(join(SECTIONS, "batch-results"))
        .filter((file) => /\.tsx?$/.test(file) && file !== "comparison-leaderboard-drawer.tsx")
        .map((file) => join(SECTIONS, "batch-results", file));
      const reachingIntoApp = controlled.filter((file) =>
        /use-router|browser-host\/drawer|useQuery|refetchInterval|useFeatureFlag|trpc/.test(
          importsOf(file),
        ),
      );
      const screenSource = readFileSync(
        join(SECTIONS, "batch-evaluation-results", "batch-evaluation-results.tsx"),
        "utf8",
      );

      expect(reachingIntoApp).toEqual([]);
      expect(screenSource).toMatch(/useRouter\(\)/);
      expect(screenSource).toMatch(/\.useQuery\(/);
      expect(screenSource).toMatch(/useDrawer\(\)/);
    });
  });
});
