import { describe, expect, it } from "vitest";

import { approximateTokens, checkPageMarkdown } from "../agent-markdown.ts";

const FENCE = "```";
const HEADER = [
  "> ## Agent Instructions",
  "> Report problems with `npx langwatch report`.",
  "",
  "# OpenAI Instrumentation",
  "",
].join("\n");
const SOURCE = ["> Page: https://langwatch.ai/docs/a", "> Source: https://github.com/x", ""].join(
  "\n",
);

function exportOf({
  description = "Trace OpenAI calls.",
  body,
}: {
  description?: string;
  body: string;
}) {
  return `${HEADER}${description ? `${description}\n\n` : ""}${SOURCE}\n${body}\n`;
}

function codes({ markdown, integration = false }: { markdown: string; integration?: boolean }) {
  return checkPageMarkdown({ markdown, integration, pageTokens: 8000 }).issues.map(
    (issue) => issue.code,
  );
}

const SAMPLE = [
  `${FENCE}python`,
  "import langwatch",
  "from openai import OpenAI",
  "",
  "langwatch.setup()",
  "client = OpenAI()",
  'client.chat.completions.create(model="gpt-5-mini", messages=[])',
  FENCE,
].join("\n");

describe("checkPageMarkdown", () => {
  describe("when a page export is over the token budget", () => {
    /** @scenario "Measure each page's Markdown export in tokens" */
    it("reports its approximate token count as characters divided by four", () => {
      const markdown = exportOf({ body: `LangWatch traces calls.\n\n${"word ".repeat(8000)}` });
      const result = checkPageMarkdown({ markdown, integration: false, pageTokens: 8000 });
      expect(result.tokens).toBe(approximateTokens({ text: markdown }));
      expect(result.tokens).toBe(Math.ceil(markdown.length / 4));
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: "tokens-over-budget", weight: result.tokens }),
      );
    });
  });

  describe("when pages open in different ways", () => {
    /** @scenario "A page answers in its first paragraph" */
    it("reports a missing description, a missing opening and an announcing opening", () => {
      expect(
        codes({ markdown: exportOf({ description: "", body: "## Install\n\nRun it." }) }),
      ).toEqual(["export-missing-description", "first-paragraph-missing"]);
      expect(
        codes({
          markdown: exportOf({ body: "In this guide we will set up tracing.\n\n## Install" }),
        }),
      ).toEqual(["first-paragraph-preamble"]);
      expect(
        codes({
          markdown: exportOf({ description: "This page explains tracing.", body: "## Install" }),
        }),
      ).toEqual(["first-paragraph-preamble"]);
    });

    /** @scenario "A page answers in its first paragraph" */
    it("passes a callout followed by a self-contained paragraph", () => {
      const body =
        "> **Tip** copy a prompt\n\nLangWatch captures every OpenAI call as a span.\n\n## Install";
      expect(codes({ markdown: exportOf({ body }) })).toEqual([]);
    });
  });

  describe("when an integration page is read", () => {
    const complete = [
      "LangWatch captures every OpenAI call.",
      "## Install",
      `${FENCE}bash\npip install langwatch openai\n${FENCE}`,
      "Set `LANGWATCH_API_KEY` in your environment.",
      SAMPLE,
      "## Verify",
      "Run the script, then open your project: you should see the trace.",
    ].join("\n\n");

    /** @scenario "An integration page gives one complete path from install to a first trace" */
    it("passes a page with install, key, a complete sample and a verify step", () => {
      expect(codes({ markdown: exportOf({ body: complete }), integration: true })).toEqual([]);
    });

    /** @scenario "An integration page gives one complete path from install to a first trace" */
    it("reports each missing part of the path", () => {
      const body = [
        "LangWatch captures every call.",
        `${FENCE}typescript\nconst x = 1;\n${FENCE}`,
        `${FENCE}python\nprint("hi")\n${FENCE}`,
      ].join("\n\n");
      const result = checkPageMarkdown({
        markdown: exportOf({ body }),
        integration: true,
        pageTokens: 8000,
      });
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "integration-no-install",
        "integration-no-env-var",
        "integration-no-complete-sample",
        "integration-no-verify",
      ]);
      expect(result.issues[0].detail).toBe("no install for python, typescript");
    });

    /** @scenario "An integration page gives one complete path from install to a first trace" */
    it("holds a page to the integration checks only when it is an integration page", () => {
      expect(codes({ markdown: exportOf({ body: "LangWatch captures calls." }) })).toEqual([]);
    });
  });

  describe("when a page has code blocks", () => {
    /** @scenario "Code samples can be pasted as they are" */
    it("reports untagged, prompted, placeholder-only and unimported blocks", () => {
      const body = [
        "LangWatch captures calls.",
        `${FENCE}\npip install langwatch\n${FENCE}`,
        `${FENCE}bash\n$ pip install langwatch\n${FENCE}`,
        `${FENCE}python\n# your code here\n...\n${FENCE}`,
        `${FENCE}python\nlangwatch.setup()\nclient = OpenAI()\n\nlangwatch.get_current_trace()\nprint(1)\n${FENCE}`,
        `${FENCE}typescript\nconst tracer = getLangWatchTracer("app");\nconst a = 1;\nconst b = 2;\nconst c = 3;\n${FENCE}`,
      ].join("\n\n");
      const result = checkPageMarkdown({
        markdown: exportOf({ body }),
        integration: false,
        pageTokens: 8000,
      });
      expect(result.issues).toEqual([
        { code: "code-untagged", detail: "1 blocks without a language", weight: 1 },
        { code: "code-shell-prompt", detail: '1 shell blocks with "$ "', weight: 1 },
        { code: "code-placeholder-only", detail: "1 placeholder blocks", weight: 1 },
        { code: "code-missing-import", detail: "2 SDK samples, no import", weight: 2 },
      ]);
    });

    /** @scenario "Code samples can be pasted as they are" */
    it("does not hold a one-line call fragment to the import rule", () => {
      const body = `LangWatch captures calls.\n\n${FENCE}python\nlangwatch.setup()\n${FENCE}\n\n${SAMPLE}`;
      expect(codes({ markdown: exportOf({ body }) })).toEqual([]);
    });
  });

  describe("when components leak into the export", () => {
    /** @scenario "Components export as readable Markdown" */
    it("names each leaked component, but not tags inside code blocks", () => {
      const body = [
        "LangWatch captures calls.",
        '<Tabs>\n  <Tab title="Python">\n    Use the SDK.\n  </Tab>\n</Tabs>',
        "<Steps>\n<Step>\nInstall.\n</Step>\n</Steps>",
        "import { Card } from './card'",
        `${FENCE}tsx\n<Card title="x" />\n${FENCE}`,
      ].join("\n\n");
      const result = checkPageMarkdown({
        markdown: exportOf({ body }),
        integration: false,
        pageTokens: 8000,
      });
      expect(result.issues).toEqual([
        {
          code: "export-raw-component",
          detail: "9 raw tags: Step, Steps, Tab, Tabs, import/export",
          weight: 9,
        },
      ]);
    });
  });
});
