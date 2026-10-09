/**
 * Pins the generated Go evaluation snippet.
 *
 * The builder replaced a five-branch if-chain that pushed one data entry per
 * field in a hardcoded order. The order now falls out of the sample-value
 * map's key order and the membership test is a single concatenated list, so
 * these tests assert the two properties the if-chain gave for free: the
 * rendered order is fixed regardless of how the caller orders its fields, and
 * a field named by both lists renders once.
 *
 * The snippet is a whole Go program, so the assertions also cover the
 * import/usage pairing that keeps it compilable — Go rejects an unused import,
 * and `io` is only used on the non-guardrail branch.
 */
import { describe, expect, it } from "vitest";

import { buildGoEvaluationSnippet } from "../EvaluationManualIntegration";

type SnippetInput = Parameters<typeof buildGoEvaluationSnippet>[0];

const buildSnippet = (overrides: Partial<SnippetInput> = {}): string =>
  buildGoEvaluationSnippet({
    name: "My Evaluator",
    checkSlug: "my-check",
    fields: [],
    isGuardrail: false,
    settingsJson: null,
    ...overrides,
  });

/**
 * The field entries of the request `data` map, in rendered order. They are the
 * only three-tab lines in the snippet, which keeps the inline `"input"` key of
 * the `conversation` sample value out of the result.
 */
const renderedDataFields = (snippet: string): string[] =>
  snippet
    .split("\n")
    .map((line) => /^\t\t\t"([a-z_]+)": /.exec(line)?.[1])
    .filter((field): field is string => field !== undefined);

describe("buildGoEvaluationSnippet", () => {
  describe("given fields drawn from the required and optional lists", () => {
    describe("when a field appears only in the required list", () => {
      it("renders that field in the request data", () => {
        expect(renderedDataFields(buildSnippet({ fields: ["input"] }))).toEqual(
          ["input"],
        );
      });
    });

    describe("when a field appears only in the optional list", () => {
      it("renders that field in the request data", () => {
        expect(
          renderedDataFields(buildSnippet({ fields: ["contexts"] })),
        ).toEqual(["contexts"]);
      });
    });

    describe("when a field is named by both lists", () => {
      it("renders that field exactly once", () => {
        const fields = renderedDataFields(
          buildSnippet({ fields: ["output", "input", "output"] }),
        );

        expect(fields).toEqual(["input", "output"]);
      });
    });

    describe("when a field is named by neither list", () => {
      it("leaves that field out of the request data", () => {
        const fields = renderedDataFields(
          buildSnippet({ fields: ["input", "output"] }),
        );

        expect(fields).not.toContain("expected_output");
        expect(fields).not.toContain("contexts");
        expect(fields).not.toContain("conversation");
      });
    });

    describe("when a requested field has no Go sample value", () => {
      it("leaves the unknown field out of the request data", () => {
        const snippet = buildSnippet({ fields: ["input", "made_up_field"] });

        expect(renderedDataFields(snippet)).toEqual(["input"]);
        expect(snippet).not.toContain("made_up_field");
      });
    });

    describe("when no fields are requested at all", () => {
      it("renders an empty map literal rather than an empty block", () => {
        const snippet = buildSnippet({ fields: [] });

        expect(renderedDataFields(snippet)).toEqual([]);
        expect(snippet).toContain(`"data": map[string]any{},`);
      });
    });
  });

  describe("given every renderable field is requested", () => {
    const everyField = [
      "input",
      "output",
      "contexts",
      "expected_output",
      "conversation",
    ];

    it("renders the data entries in the documented order", () => {
      expect(renderedDataFields(buildSnippet({ fields: everyField }))).toEqual([
        "input",
        "output",
        "contexts",
        "expected_output",
        "conversation",
      ]);
    });

    describe("when the caller supplies the fields in a different order", () => {
      it("renders the same order regardless of the caller's ordering", () => {
        const reversed = renderedDataFields(
          buildSnippet({ fields: [...everyField].reverse() }),
        );

        expect(reversed).toEqual(
          renderedDataFields(buildSnippet({ fields: everyField })),
        );
      });
    });
  });

  describe("given the settings JSON", () => {
    describe("when the caller keeps the settings on LangWatch", () => {
      it("posts no settings entry", () => {
        const snippet = buildSnippet({ settingsJson: null });

        expect(snippet).not.toContain(`"settings"`);
        expect(snippet).not.toContain("json.RawMessage");
      });
    });

    describe("when the caller stores populated settings on code", () => {
      it("embeds the settings as a JSON message", () => {
        const snippet = buildSnippet({
          settingsJson: `{"threshold":0.5,"strict":true}`,
        });

        expect(snippet).toContain(
          '"settings": json.RawMessage("{\\"threshold\\":0.5,\\"strict\\":true}"),',
        );
      });
    });

    describe("when the caller stores settings on code but has none set", () => {
      it("still posts a settings entry for the empty object", () => {
        const snippet = buildSnippet({ settingsJson: "{}" });

        expect(snippet).toContain('"settings": json.RawMessage("{}"),');
      });
    });

    // A backtick used to terminate the Go raw literal the settings were
    // embedded in, leaving the snippet unparseable. Custom LLM evaluators
    // carry free-text prompts, so this is reachable from user input.
    describe("when the settings contain a backtick", () => {
      const settingsJson = `{"prompt":"Rate this \`code\` fairly"}`;

      it("emits no raw literal for the settings", () => {
        const snippet = buildSnippet({ settingsJson });

        expect(snippet).toContain("json.RawMessage(");
        expect(snippet).not.toContain("json.RawMessage(`");
      });

      it("emits a literal that decodes back to the original settings", () => {
        const snippet = buildSnippet({ settingsJson });

        const literal = /json\.RawMessage\((".*?[^\\]")\),/.exec(snippet)?.[1];
        expect(literal).toBeDefined();
        expect(JSON.parse(literal!)).toBe(settingsJson);
      });
    });
  });

  describe("given the evaluator runs as a guardrail", () => {
    const guardrail = () =>
      buildSnippet({ fields: ["input"], isGuardrail: true });

    it("flags the request as a guardrail call", () => {
      expect(guardrail()).toContain(`"as_guardrail": true,`);
    });

    it("decodes the passed flag and short-circuits when it fails", () => {
      const snippet = guardrail();

      expect(snippet).toContain('Passed bool `json:"passed"`');
      expect(snippet).toContain("if !guardrail.Passed {");
      expect(snippet).toContain("return");
    });

    it("drops the io import it no longer uses", () => {
      const snippet = guardrail();

      expect(snippet).not.toContain("io.ReadAll");
      expect(snippet).not.toContain(`\t"io"`);
    });
  });

  describe("given the evaluator runs as a plain evaluation", () => {
    const evaluation = () =>
      buildSnippet({ fields: ["input"], isGuardrail: false });

    it("omits the guardrail flag and the guardrail decode", () => {
      const snippet = evaluation();

      expect(snippet).not.toContain("as_guardrail");
      expect(snippet).not.toContain("guardrail.Passed");
    });

    it("prints the raw response body and imports the io it reads with", () => {
      const snippet = evaluation();

      expect(snippet).toContain("io.ReadAll(resp.Body)");
      expect(snippet).toContain(`\t"io"`);
    });
  });

  describe("given the evaluator slug", () => {
    describe("when the evaluator has been saved", () => {
      it("posts to that evaluator's evaluate endpoint", () => {
        expect(buildSnippet({ checkSlug: "pii-detection" })).toContain(
          "/api/evaluations/pii-detection/evaluate",
        );
      });
    });

    // The extracted signature widened `checkSlug` to `string | undefined`, but
    // the only call site derives it from `slugify(name)`, which always returns
    // a string. Nothing reachable today produces this path. If something ever
    // does, the Go tab prints the missing slug exactly as the Python,
    // TypeScript and curl tabs already do, so the fix belongs to all four at
    // once rather than to this builder alone.
    describe("when no slug reaches the builder", () => {
      it("interpolates the absent slug the way every other language tab does", () => {
        expect(buildSnippet({ checkSlug: undefined })).toContain(
          "/api/evaluations/undefined/evaluate",
        );
      });
    });
  });

  describe("given the evaluator name", () => {
    it("sends the name the evaluation is recorded under", () => {
      expect(buildSnippet({ name: "Toxicity Check" })).toContain(
        `"name": "Toxicity Check",`,
      );
    });
  });
});
