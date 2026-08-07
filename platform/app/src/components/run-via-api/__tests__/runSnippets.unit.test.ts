/**
 * Unit tests for the pure Run via API snippet generator.
 *
 * Covers every (language x data source) combination for both targets
 * (workflow + experiment): the right trigger call, the right data-source
 * argument, and a "read the results back" block. Dataset-backed snippets must
 * omit fields the dataset already provides.
 *
 * Go has no SDK entry point, so its snippet drives the REST API directly: the
 * assertions there cover the bearer auth, the bounded poll loop, and the
 * escaping that keeps a hostile field identifier inside the generated literal.
 */
import { describe, expect, it } from "vitest";

import {
  type BuildRunSnippetInput,
  buildRunSnippet,
  type RunSnippetLang,
} from "../runSnippets";

const baseInput: Omit<BuildRunSnippetInput, "dataSource" | "lang"> = {
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
      const snippet = buildRunSnippet({
        ...baseInput,
        dataSource: "attached",
        lang: "python",
      });
      expect(snippet).toContain("feature_flag");
      expect(snippet).not.toContain('"question"');
    });

    describe("when an image field is not provided by the dataset", () => {
      /** @scenario An image entry field gets a base64 data-url example */
      it("uses a base64 data-url example for the image field", () => {
        const snippet = buildRunSnippet({
          ...baseInput,
          entryFields: [{ identifier: "screenshot", type: "image" }],
          datasetColumns: [],
          dataSource: "inline",
          lang: "python",
        });
        expect(snippet).toContain("data:image/png;base64,");
      });
    });

    describe("when the dataset covers every entry field", () => {
      /** @scenario When the dataset covers every field the example shows an illustrative flag */
      it("falls back to an illustrative feature-flag value", () => {
        const snippet = buildRunSnippet({
          ...baseInput,
          entryFields: [{ identifier: "question", type: "str" }],
          datasetColumns: ["question"],
          dataSource: "attached",
          lang: "python",
        });
        expect(snippet).toContain("variant-b");
      });
    });
  });

  describe("given the inline-data source", () => {
    /** @scenario The inline-data snippet shows example rows */
    it("shows a small list of example rows, not the whole dataset", () => {
      const python = buildRunSnippet({
        ...baseInput,
        dataSource: "inline",
        lang: "python",
      });
      expect(python).toContain("data=[");
      // Only the field the dataset does not provide appears in the inline row.
      expect(python).toContain("feature_flag");
      expect(python).not.toContain('"question"');

      const ts = buildRunSnippet({
        ...baseInput,
        dataSource: "inline",
        lang: "typescript",
      });
      expect(ts).toContain("data: [");
    });
  });

  describe("given the dataset-id source", () => {
    /** @scenario The dataset-id snippet shows a dataset id placeholder */
    it("shows a dataset id field with a placeholder to replace", () => {
      const python = buildRunSnippet({
        ...baseInput,
        dataSource: "dataset_id",
        lang: "python",
      });
      expect(python).toContain("dataset_id=");
      expect(python).toContain("dataset_xxxxxxxxxxxx");

      const ts = buildRunSnippet({
        ...baseInput,
        dataSource: "dataset_id",
        lang: "typescript",
      });
      expect(ts).toContain("datasetId:");

      const shell = buildRunSnippet({
        ...baseInput,
        dataSource: "dataset_id",
        lang: "shell",
      });
      expect(shell).toContain('"dataset_id"');
    });
  });

  describe("given each language", () => {
    /** @scenario Each language snippet shows how to read the results back */
    it("reads the results back in Python, TypeScript, and Shell", () => {
      const python = buildRunSnippet({
        ...baseInput,
        dataSource: "attached",
        lang: "python",
      });
      expect(python).toContain("result.results");
      expect(python).toContain("result.run_url");

      const ts = buildRunSnippet({
        ...baseInput,
        dataSource: "attached",
        lang: "typescript",
      });
      expect(ts).toContain("res.rows");
      expect(ts).toContain("res.runUrl");

      const shell = buildRunSnippet({
        ...baseInput,
        dataSource: "attached",
        lang: "shell",
      });
      // Starts the run, polls it, then fetches the results.
      expect(shell).toContain("/run");
      expect(shell).toContain("/api/experiments/runs/$RUN_ID");
      expect(shell).toContain("/api/experiments/runs/$RUN_ID/results");
    });
  });

  describe("when the shell snippet polls for the run to finish", () => {
    const shell = () =>
      buildRunSnippet({
        ...baseInput,
        dataSource: "attached",
        lang: "shell",
      });

    it("bounds the poll loop instead of looping forever", () => {
      expect(shell()).not.toContain("while true");
      expect(shell()).toContain("MAX_ATTEMPTS");
    });

    it("gives up on a 404 rather than polling a run that cannot appear", () => {
      const snippet = shell();
      expect(snippet).toContain("%{http_code}");
      expect(snippet).toContain('if [ "$CODE" = "404" ]');
      expect(snippet).toContain("giving up");
    });

    it("gives up on any other non-200 status instead of parsing it as the run body", () => {
      const snippet = shell();
      expect(snippet).toContain('if [ "$CODE" != "200" ]');
    });

    it("breaks on every terminal status the API can report", () => {
      expect(shell()).toContain(
        'case "$STATUS" in completed|failed|stopped|interrupted) break;; esac',
      );
    });

    it("does not advertise an events stream the API does not serve", () => {
      expect(shell()).not.toContain("/events");
    });
  });

  describe("given the Go language", () => {
    const go = (overrides: Partial<BuildRunSnippetInput> = {}) =>
      buildRunSnippet({
        ...baseInput,
        dataSource: "attached",
        lang: "go",
        ...overrides,
      });

    describe("when the attached-dataset source is selected", () => {
      it("marshals the unprovided field into parameters and omits the dataset-backed one", () => {
        const snippet = go();
        expect(snippet).toContain('"parameters": map[string]any{');
        expect(snippet).toContain("feature_flag");
        expect(snippet).not.toContain('"question"');
      });
    });

    describe("when the inline-data source is selected", () => {
      it("marshals the example row into a data slice", () => {
        const snippet = go({ dataSource: "inline" });
        expect(snippet).toContain('"data": []map[string]any{{');
        expect(snippet).toContain("feature_flag");
      });
    });

    describe("when the dataset-id source is selected", () => {
      it("marshals a dataset id with a placeholder to replace", () => {
        const snippet = go({ dataSource: "dataset_id" });
        expect(snippet).toContain('"dataset_id": "dataset_xxxxxxxxxxxx"');
        expect(snippet).not.toContain('"parameters"');
        expect(snippet).not.toContain('"data"');
      });
    });

    it("authenticates with a bearer token, not the legacy auth header", () => {
      const snippet = go();
      expect(snippet).toContain(
        '"Authorization", "Bearer "+os.Getenv("LANGWATCH_API_KEY")',
      );
      expect(snippet).not.toContain("X-Auth-Token");
    });

    it("starts the run, polls it, then reads the per-row results back", () => {
      const snippet = go();
      expect(snippet).toMatch(
        /startPath\s+= "\/api\/experiments\/my-experiment\/run"/,
      );
      expect(snippet).toContain('baseURL + "/api/experiments/runs/" + runID');
      expect(snippet).toContain('"/api/experiments/runs/"+runID+"/results"');
    });

    it("bounds the poll loop instead of looping forever", () => {
      const snippet = go();
      expect(snippet).not.toContain("for {");
      expect(snippet).toContain("attempt < maxAttempts");
    });

    it("gives up on a 404 rather than polling a run that cannot appear", () => {
      const snippet = go();
      expect(snippet).toContain("code == http.StatusNotFound");
      expect(snippet).toContain("giving up");
    });

    it("gives up on any other non-200 status instead of parsing it as the run body", () => {
      expect(go()).toContain("code != http.StatusOK");
    });

    it("stops on every terminal status the API can report", () => {
      const snippet = go();
      for (const status of ["completed", "failed", "stopped", "interrupted"]) {
        expect(snippet).toContain(`"${status}":`);
      }
      expect(snippet).toContain("terminalStatuses[run.Status]");
    });

    it("reads the run id under both the experiment and workflow field names", () => {
      const snippet = go();
      expect(snippet).toContain('json:"runId"');
      expect(snippet).toContain('json:"run_id"');
    });

    describe("when an entry field identifier contains Go string metacharacters", () => {
      it("escapes them into the map key instead of ending the literal early", () => {
        const snippet = go({
          entryFields: [{ identifier: 'sneaky", "injected', type: "str" }],
          datasetColumns: [],
          dataSource: "inline",
        });
        expect(snippet).toContain(String.raw`"sneaky\", \"injected":`);
      });
    });
  });

  describe("given the experiment kind", () => {
    it("calls the experiment SDK entry points", () => {
      const input = { ...baseInput, kind: "experiment" as const };
      expect(
        buildRunSnippet({ ...input, dataSource: "attached", lang: "python" }),
      ).toContain('langwatch.experiment.run("my-experiment"');
      expect(
        buildRunSnippet({
          ...input,
          dataSource: "attached",
          lang: "typescript",
        }),
      ).toContain('langwatch.experiments.runWithResults("my-experiment"');
      expect(
        buildRunSnippet({ ...input, dataSource: "attached", lang: "shell" }),
      ).toContain("/api/experiments/my-experiment/run");
      expect(
        buildRunSnippet({ ...input, dataSource: "attached", lang: "go" }),
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
        buildRunSnippet({ ...input, dataSource: "attached", lang: "python" }),
      ).toContain('langwatch.workflow.run("workflow_abc123"');
      expect(
        buildRunSnippet({
          ...input,
          dataSource: "attached",
          lang: "typescript",
        }),
      ).toContain('langwatch.workflows.run("workflow_abc123"');
      expect(
        buildRunSnippet({ ...input, dataSource: "attached", lang: "shell" }),
      ).toContain("/api/workflows/workflow_abc123/evaluate");
      expect(
        buildRunSnippet({ ...input, dataSource: "attached", lang: "go" }),
      ).toContain("/api/workflows/workflow_abc123/evaluate");
    });
  });

  describe("given every language and data source", () => {
    const langs: RunSnippetLang[] = ["python", "typescript", "go", "shell"];
    const sources = ["attached", "inline", "dataset_id"] as const;

    it("produces a non-empty snippet for each combination", () => {
      for (const lang of langs) {
        for (const dataSource of sources) {
          const snippet = buildRunSnippet({ ...baseInput, dataSource, lang });
          expect(snippet.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
