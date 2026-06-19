import { describe, expect, it } from "vitest";

import type { Entry, Workflow } from "~/optimization_studio/types/dsl";
import { injectEntryParameters } from "../workflowEvaluation.service";

const workflowWith = (entry: Partial<Entry>): Workflow =>
  ({
    nodes: [{ id: "entry", type: "entry", data: entry }],
    edges: [],
  }) as unknown as Workflow;

const entryOf = (workflow: Workflow) =>
  workflow.nodes.find((n) => n.id === "entry")!.data as Entry;

describe("injectEntryParameters", () => {
  describe("given an entry field with a default the caller did not provide", () => {
    it("backfills the missing field with its default on every row", () => {
      const workflow = workflowWith({
        outputs: [
          { identifier: "query", type: "str" },
          { identifier: "lang", type: "str", value: "en" },
        ],
        dataset: {
          inline: {
            records: { query: ["a", "b"] },
            columnTypes: [{ name: "query", type: "string" }],
          },
        },
      });

      injectEntryParameters(workflow, { query: "override" });

      const inline = entryOf(workflow).dataset!.inline!;
      // provided param wins on every row, defaulted field is backfilled
      expect(inline.records.query).toEqual(["override", "override"]);
      expect(inline.records.lang).toEqual(["en", "en"]);
    });
  });

  describe("given a provided parameter that also has a default", () => {
    it("uses the provided value, not the default", () => {
      const workflow = workflowWith({
        outputs: [{ identifier: "lang", type: "str", value: "en" }],
        dataset: {
          inline: { records: {}, columnTypes: [] },
        },
      });

      injectEntryParameters(workflow, { lang: "fr" });

      expect(entryOf(workflow).dataset!.inline!.records.lang).toEqual(["fr"]);
    });
  });

  describe("given no dataset and a defaulted field", () => {
    it("builds a synthetic single row carrying the default", () => {
      const workflow = workflowWith({
        outputs: [
          { identifier: "topic", type: "str" },
          { identifier: "lang", type: "str", value: "en" },
        ],
      });

      injectEntryParameters(workflow, { topic: "weather" });

      const inline = entryOf(workflow).dataset!.inline!;
      expect(inline.records.topic).toEqual(["weather"]);
      expect(inline.records.lang).toEqual(["en"]);
    });
  });
});
