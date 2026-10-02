/**
 * @see modules/analytics/specs/analytics-lwql-editor.feature
 */
import { describe, expect, it } from "vitest";

import { lwqlCompletions } from "../lwql-completion.ts";
import { lwqlHoverAt } from "../lwql-hover.ts";
import { SCHEMA } from "./lwql-fixture.fixture.ts";

function complete({
  text,
  parameters,
}: {
  text: string;
  parameters?: { name: string; type?: string }[];
}) {
  const marker = text.indexOf("|");
  const source = text.replace("|", "");
  return lwqlCompletions({ schema: SCHEMA, text: source, offset: marker, parameters });
}

describe("LangWatchQL completion", () => {
  describe("given a schema with several datasets", () => {
    describe("when the cursor sits after FROM", () => {
      /** @scenario "Dataset names complete after FROM in the schema's order" */
      it("offers every dataset as analytics.<name>, in the schema's order", () => {
        const { items } = complete({ text: "SELECT 1 FROM |" });
        const ordered = items.toSorted((a, b) => a.sortText.localeCompare(b.sortText));
        expect(ordered.map((i) => i.insertText)).toEqual(["analytics.traces", "analytics.spans"]);
        expect(items.every((i) => i.kind === "table")).toBe(true);
      });

      it("offers bare names once analytics. is typed", () => {
        const { items } = complete({ text: "SELECT 1 FROM analytics.|" });
        expect(items.map((i) => i.insertText)).toEqual(["traces", "spans"]);
      });
    });
  });

  describe("given a statement reading one dataset under an alias", () => {
    describe("when the cursor follows the alias and a dot", () => {
      /** @scenario "Columns complete for the datasets in scope with type and description" */
      it("offers that dataset's columns with type and description", () => {
        const { items } = complete({ text: "SELECT t.| FROM analytics.traces AS t" });
        const duration = items.find((i) => i.label === "DurationMs");
        expect(duration).toMatchObject({
          detail: "UInt64 (ms)",
          documentation: "How long the trace took.",
        });
        expect(items.find((i) => i.label === "SpanId")).toBeUndefined();
      });

      it("offers the columns of every dataset in scope when no qualifier is typed", () => {
        const { items } = complete({
          text: "SELECT | FROM analytics.traces JOIN analytics.spans s ON 1",
        });
        expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(["TraceId", "SpanId"]));
      });
    });
  });

  describe("given a schema listing a column that is not available", () => {
    describe("when columns are offered", () => {
      /** @scenario "A withheld column is shown disabled with its gate and is never inserted" */
      it("names the gate and inserts only what was already typed", () => {
        const { items } = complete({ text: "SELECT Tot| FROM analytics.traces" });
        const cost = items.find((i) => i.label === "TotalCost");
        expect(cost?.disabled).toBe(true);
        expect(cost?.detail).toContain("cost:view");
        expect(cost?.insertText).toBe("Tot");
      });
    });
  });

  describe("given a schema with an available app function", () => {
    describe("when functions are offered", () => {
      /** @scenario "App functions complete with their signature snippet" */
      it("inserts a snippet with a stop for each argument", () => {
        const { items } = complete({ text: "SELECT conv| FROM analytics.traces" });
        const app = items.find((i) => i.label === "conversation_bounded");
        expect(app).toMatchObject({
          isSnippet: true,
          insertText: "conversation_bounded(${1:thread_key}, ${2:max_tokens})",
        });
        expect(items.filter((i) => i.label === "conversation_bounded")).toHaveLength(1);
      });
    });
  });

  describe("given a parameter the host offers", () => {
    describe("when the cursor follows an opening brace", () => {
      /** @scenario "A parameter completes as its bound token" */
      it("offers it as {name:Type} and replaces the brace", () => {
        const source = "WHERE t > {per";
        const { items, replaceFrom } = lwqlCompletions({
          schema: SCHEMA,
          text: source,
          offset: source.length,
          parameters: [{ name: "period_start", type: "DateTime" }],
        });
        expect(items.map((i) => i.insertText)).toEqual(["{period_start:DateTime}"]);
        expect(replaceFrom).toBe(source.indexOf("{"));
      });
    });
  });

  describe("given no schema", () => {
    describe("when completion is asked", () => {
      it("offers keywords only", () => {
        const { items } = lwqlCompletions({ schema: undefined, text: "SEL", offset: 3 });
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((i) => i.kind === "keyword")).toBe(true);
      });

      it("offers nothing inside a string", () => {
        expect(lwqlCompletions({ schema: SCHEMA, text: "WHERE a = 'x", offset: 12 }).items).toEqual(
          [],
        );
      });
    });
  });
});

describe("LangWatchQL hover", () => {
  describe("given a schema whose column carries a type, unit and description", () => {
    describe("when the cursor rests on that column", () => {
      /** @scenario "Hover shows the schema's own description of an identifier" */
      it("names the type and unit and reproduces the description", () => {
        const text = "SELECT DurationMs FROM analytics.traces";
        const hover = lwqlHoverAt({ schema: SCHEMA, text, offset: text.indexOf("DurationMs") + 2 });
        expect(hover?.contents).toEqual([
          "**DurationMs** · `UInt64` (ms)",
          "How long the trace took.",
        ]);
      });

      it("has nothing to say about an unknown word", () => {
        const text = "SELECT nothing FROM analytics.traces";
        expect(lwqlHoverAt({ schema: SCHEMA, text, offset: 9 })).toBeUndefined();
      });
    });
  });
});
