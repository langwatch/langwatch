/**
 * Unit tests for the pure Run via API snippet generator.
 *
 * Covers every (language x data source) combination for both targets
 * (workflow + experiment): the right trigger call, the right data-source
 * argument, and a "read the results back" block. Dataset-backed snippets must
 * omit fields the dataset already provides.
 */
import { describe, expect, it } from "vitest";

import {
  type BuildRunSnippetInput,
  buildRunSnippet,
  type RunSnippetLang,
} from "../runSnippets";

const baseInput: Omit<BuildRunSnippetInput, "dataSource"> = {
  kind: "experiment",
  identifier: "my-experiment",
  baseUrl: "https://app.langwatch.ai",
  entryFields: [
    { identifier: "question", type: "str" },
    { identifier: "feature_flag", type: "str" },
  ],
  datasetColumns: ["question"],
  datasetName: "My Dataset",
  projectSlug: "my-project",
};

describe("buildRunSnippet", () => {
  describe("given the attached-dataset source", () => {
    /** @scenario The parameters example omits fields the dataset already provides */
    it("includes the unprovided field and omits the dataset-backed one", () => {
      const snippet = buildRunSnippet(
        { ...baseInput, dataSource: "attached" },
        "python",
      );
      expect(snippet).toContain("feature_flag");
      expect(snippet).not.toContain('"question"');
    });

    describe("when an image field is not provided by the dataset", () => {
      /** @scenario An image entry field gets a base64 data-url example */
      it("uses a base64 data-url example for the image field", () => {
        const snippet = buildRunSnippet(
          {
            ...baseInput,
            entryFields: [{ identifier: "screenshot", type: "image" }],
            datasetColumns: [],
            dataSource: "inline",
          },
          "python",
        );
        expect(snippet).toContain("data:image/png;base64,");
      });
    });

    describe("when the dataset covers every entry field", () => {
      /** @scenario When the dataset covers every field the example shows an illustrative flag */
      it("falls back to an illustrative feature-flag value", () => {
        const snippet = buildRunSnippet(
          {
            ...baseInput,
            entryFields: [{ identifier: "question", type: "str" }],
            datasetColumns: ["question"],
            dataSource: "attached",
          },
          "python",
        );
        expect(snippet).toContain("variant-b");
      });
    });
  });

  describe("given the inline-data source", () => {
    /** @scenario The inline-data snippet shows example rows */
    it("shows a small list of example rows, not the whole dataset", () => {
      const python = buildRunSnippet(
        { ...baseInput, dataSource: "inline" },
        "python",
      );
      expect(python).toContain("data=[");
      // Only the field the dataset does not provide appears in the inline row.
      expect(python).toContain("feature_flag");
      expect(python).not.toContain('"question"');

      const ts = buildRunSnippet(
        { ...baseInput, dataSource: "inline" },
        "typescript",
      );
      expect(ts).toContain("data: [");
    });
  });

  describe("given the dataset-id source", () => {
    /** @scenario The dataset-id snippet shows a dataset id placeholder */
    it("shows a dataset id field with a placeholder to replace", () => {
      const python = buildRunSnippet(
        { ...baseInput, dataSource: "dataset_id" },
        "python",
      );
      expect(python).toContain("dataset_id=");
      expect(python).toContain("dataset_xxxxxxxxxxxx");

      const ts = buildRunSnippet(
        { ...baseInput, dataSource: "dataset_id" },
        "typescript",
      );
      expect(ts).toContain("datasetId:");

      const shell = buildRunSnippet(
        { ...baseInput, dataSource: "dataset_id" },
        "shell",
      );
      expect(shell).toContain('"dataset_id"');
    });
  });

  describe("given each language", () => {
    /** @scenario Each language snippet shows how to read the results back */
    it("reads the results back in Python, TypeScript, and Shell", () => {
      const python = buildRunSnippet(
        { ...baseInput, dataSource: "attached" },
        "python",
      );
      expect(python).toContain("result.results");
      expect(python).toContain("result.run_url");

      const ts = buildRunSnippet(
        { ...baseInput, dataSource: "attached" },
        "typescript",
      );
      expect(ts).toContain("res.rows");
      expect(ts).toContain("res.runUrl");

      const shell = buildRunSnippet(
        { ...baseInput, dataSource: "attached" },
        "shell",
      );
      // Starts the run, polls it, then fetches the results.
      expect(shell).toContain("/run");
      expect(shell).toContain("/api/experiments/runs/$RUN_ID");
      expect(shell).toContain("/api/experiments/runs/$RUN_ID/results");
    });
  });

  describe("given the experiment kind", () => {
    it("calls the experiment SDK entry points", () => {
      const input = { ...baseInput, kind: "experiment" as const };
      expect(
        buildRunSnippet({ ...input, dataSource: "attached" }, "python"),
      ).toContain('langwatch.experiment.run("my-experiment"');
      expect(
        buildRunSnippet({ ...input, dataSource: "attached" }, "typescript"),
      ).toContain('langwatch.experiments.runWithResults("my-experiment"');
      expect(
        buildRunSnippet({ ...input, dataSource: "attached" }, "shell"),
      ).toContain("/api/experiments/my-experiment/run");
    });
  });

  describe("given the workflow kind", () => {
    it("calls the workflow SDK entry points and evaluate endpoint", () => {
      const input = {
        ...baseInput,
        kind: "workflow" as const,
        identifier: "workflow_abc123",
      };
      expect(
        buildRunSnippet({ ...input, dataSource: "attached" }, "python"),
      ).toContain('langwatch.workflow.run("workflow_abc123"');
      expect(
        buildRunSnippet({ ...input, dataSource: "attached" }, "typescript"),
      ).toContain('langwatch.workflows.run("workflow_abc123"');
      expect(
        buildRunSnippet({ ...input, dataSource: "attached" }, "shell"),
      ).toContain("/api/workflows/workflow_abc123/evaluate");
    });
  });

  describe("given every language and data source", () => {
    const langs: RunSnippetLang[] = ["python", "typescript", "shell"];
    const sources = ["attached", "inline", "dataset_id"] as const;

    it("produces a non-empty snippet for each combination", () => {
      for (const lang of langs) {
        for (const dataSource of sources) {
          const snippet = buildRunSnippet({ ...baseInput, dataSource }, lang);
          expect(snippet.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
