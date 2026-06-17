import { describe, expect, it } from "vitest";

import {
  buildEvaluateParameters,
  evaluateCurlSnippet,
  exampleParameterValue,
} from "../evaluateApiSnippet";

describe("buildEvaluateParameters", () => {
  describe("given entry fields with and without matching dataset columns", () => {
    describe("when building the example parameters", () => {
      it("includes only the fields the dataset does not provide", () => {
        const parameters = buildEvaluateParameters({
          entryFields: [
            { identifier: "input", type: "str" },
            { identifier: "feature_flag", type: "str" },
          ],
          datasetColumns: ["input"],
        });

        expect(parameters).toEqual({ feature_flag: "example" });
      });
    });
  });

  describe("given a non-scalar entry field the dataset does not provide", () => {
    describe("when building the example parameters", () => {
      it("omits it because parameters accept only scalar values", () => {
        const parameters = buildEvaluateParameters({
          entryFields: [
            { identifier: "messages", type: "chat_messages" },
            { identifier: "config", type: "dict" },
            { identifier: "items", type: "list[str]" },
          ],
          datasetColumns: [],
        });

        expect(parameters).toEqual({});
      });
    });
  });

  describe("given scalar entry fields of each type", () => {
    describe("when building the example parameters", () => {
      it("uses an example value matching the field type", () => {
        const parameters = buildEvaluateParameters({
          entryFields: [
            { identifier: "name", type: "str" },
            { identifier: "score", type: "float" },
            { identifier: "count", type: "int" },
            { identifier: "enabled", type: "bool" },
          ],
          datasetColumns: [],
        });

        expect(parameters).toEqual({
          name: "example",
          score: 0.5,
          count: 42,
          enabled: true,
        });
      });
    });
  });

  describe("given an image-typed entry field", () => {
    describe("when resolving its example value", () => {
      it("uses a base64 data-url so the structure is clear", () => {
        expect(exampleParameterValue("image")).toMatch(
          /^data:image\/png;base64,/,
        );
      });
    });
  });
});

describe("evaluateCurlSnippet", () => {
  const base = {
    workflowId: "workflow_abc123",
    baseUrl: "https://app.langwatch.ai",
  };

  describe("given entry fields the dataset does not provide", () => {
    describe("when generating the snippet", () => {
      it("maps them into the parameters block with the endpoint and auth header", () => {
        const snippet = evaluateCurlSnippet({
          ...base,
          entryFields: [
            { identifier: "input", type: "str" },
            { identifier: "feature_flag", type: "str" },
          ],
          datasetColumns: ["input"],
          datasetName: "My Dataset",
        });

        expect(snippet).toContain("/api/workflows/workflow_abc123/evaluate");
        expect(snippet).toContain("X-Auth-Token");
        expect(snippet).toContain('"feature_flag": "example"');
        expect(snippet).not.toContain('"input"');
      });
    });
  });

  describe("given an image entry field the dataset does not provide", () => {
    describe("when generating the snippet", () => {
      it("shows a base64 data-url example for it", () => {
        const snippet = evaluateCurlSnippet({
          ...base,
          entryFields: [{ identifier: "screenshot", type: "image" }],
          datasetColumns: [],
        });

        expect(snippet).toContain('"screenshot": "data:image/png;base64,');
      });
    });
  });

  describe("given every entry field already matches a dataset column", () => {
    describe("when generating the snippet", () => {
      it("falls back to an illustrative feature-flag example", () => {
        const snippet = evaluateCurlSnippet({
          ...base,
          entryFields: [{ identifier: "input", type: "str" }],
          datasetColumns: ["input"],
          datasetName: "My Dataset",
        });

        expect(snippet).toContain('"feature_flag": "variant-b"');
      });
    });
  });

  describe("given a named attached dataset", () => {
    describe("when generating the snippet", () => {
      it("states the run uses that dataset", () => {
        const snippet = evaluateCurlSnippet({
          ...base,
          entryFields: [{ identifier: "input", type: "str" }],
          datasetColumns: ["input"],
          datasetName: "My Dataset",
        });

        expect(snippet).toContain('attached dataset ("My Dataset")');
      });
    });
  });

  describe("given no dataset attached", () => {
    describe("when generating the snippet", () => {
      it("explains the parameters form the single evaluated row", () => {
        const snippet = evaluateCurlSnippet({
          ...base,
          entryFields: [{ identifier: "query", type: "str" }],
          datasetColumns: [],
        });

        expect(snippet).toContain("no dataset attached");
        expect(snippet).toContain('"query": "example"');
      });
    });
  });
});
