/**
 * Integration tests for Dataset API
 *
 * These tests run against a real LangWatch backend at localhost:5560
 * Set LANGWATCH_API_KEY and LANGWATCH_ENDPOINT environment variables
 */
import { describe, it, expect, beforeAll } from "vitest";
import { LangWatch } from "@/client-sdk";

// Skip if no API key (CI environments without backend)
const SKIP_INTEGRATION = !process.env.LANGWATCH_API_KEY;

describe.skipIf(SKIP_INTEGRATION)("Dataset Integration", () => {
  let langwatch: LangWatch;

  beforeAll(() => {
    langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560",
    });
  });

  describe("get()", () => {
    it("returns dataset entries when given valid slug", async () => {
      // This test requires a dataset to exist in the backend
      // You can create one via the UI or API before running tests
      const datasetSlug = process.env.TEST_DATASET_SLUG;

      if (!datasetSlug) {
        console.log("Skipping: TEST_DATASET_SLUG not set");
        return;
      }

      const dataset = await langwatch.datasets.get(datasetSlug);

      expect(dataset).toBeDefined();
      expect(dataset.entries).toBeInstanceOf(Array);
    });

    it("returns typed dataset entries", async () => {
      const datasetSlug = process.env.TEST_DATASET_SLUG;

      if (!datasetSlug) {
        console.log("Skipping: TEST_DATASET_SLUG not set");
        return;
      }

      type MyEntry = {
        input: string;
        expected_output?: string;
      };

      const dataset = await langwatch.datasets.get<MyEntry>(datasetSlug);

      expect(dataset.entries).toBeInstanceOf(Array);
      // TypeScript should type-check entry.entry as MyEntry
      for (const entry of dataset.entries) {
        expect(entry.entry).toBeDefined();
      }
    });

    it("throws error for non-existent dataset", async () => {
      // Backend returns 401/404 for non-existent datasets depending on project access
      await expect(
        langwatch.datasets.get("non-existent-dataset-slug-12345")
      ).rejects.toThrow(); // Either DatasetNotFoundError or DatasetApiError
    });
  });

  describe("dataset with evaluation", () => {
    it("uses dataset entries in evaluation.run()", async () => {
      const datasetSlug = process.env.TEST_DATASET_SLUG;

      if (!datasetSlug) {
        console.log("Skipping: TEST_DATASET_SLUG not set");
        return;
      }

      // Fetch dataset
      const dataset = await langwatch.datasets.get(datasetSlug);

      // Use in evaluation
      const evaluation = await langwatch.evaluation.init(
        `test-dataset-eval-${Date.now()}`
      );

      const processed: number[] = [];

      await evaluation.run(
        dataset.entries.map((e) => e.entry),
        async ({ index }) => {
          processed.push(index);
        }
      );

      expect(processed.length).toBe(dataset.entries.length);
    });
  });
});

// Unit tests that don't require backend
describe("Dataset Unit", () => {
  describe("DatasetsFacade", () => {
    it("exposes get method", () => {
      const langwatch = new LangWatch({
        apiKey: "test-key",
        endpoint: "http://localhost:5560",
      });

      expect(langwatch.datasets).toBeDefined();
      expect(langwatch.datasets.get).toBeDefined();
      expect(typeof langwatch.datasets.get).toBe("function");
    });
  });
});
