import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { docsRoot } from "../../../paths.ts";
import { docsFixture } from "../../../testing/docs-fixture.ts";
import { withoutFrontmatter } from "../../content/compile/frontmatter.ts";
import { promptFileName } from "../../content/compile/skill-prompts.ts";
import { mdxComponents } from "../../content/ui/mdx-components.ts";
import { agentInstructions, pageMarkdown, readableSchema } from "../compile/markdown-export.ts";
import { MARKDOWN_COMPONENTS, mdxToMarkdown } from "../compile/mdx-markdown.ts";

describe("when an API page contains only OpenAPI frontmatter", () => {
  /** @scenario "Export complete API operations for agents" */
  it("exports resolved request and response details and rejects unresolved operations", () => {
    const fixture = docsFixture({
      config: {},
      pages: {
        "api.mdx": "---\ntitle: Create trace\nopenapi: POST /traces/{id}\n---\n",
        "missing.mdx": "---\nopenapi: GET /missing\n---\n",
      },
      main: {
        servers: [{ url: "https://api.example.com/v1" }],
        security: [{ token: [] }],
        components: {
          securitySchemes: { token: { type: "apiKey", in: "header", name: "X-Auth-Token" } },
          schemas: { Trace: { type: "object", properties: { name: { type: "string" } } } },
        },
        paths: {
          "/traces/{id}": {
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            post: {
              description: "Record a trace.",
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Trace" },
                    example: { name: "demo" },
                  },
                },
              },
              responses: {
                "201": {
                  description: "Created",
                  content: { "application/json": { schema: { type: "boolean" }, example: false } },
                },
                "204": { description: "No content" },
              },
            },
          },
        },
      },
    });
    try {
      const markdown = pageMarkdown({ docsRoot: fixture.docsRoot, slug: "api" });
      expect(markdown).toContain("# Create trace\n\nRecord a trace.");
      expect(markdown).toContain("POST https://api.example.com/v1/traces/{id}");
      expect(markdown).toContain('"name":"X-Auth-Token"');
      expect(markdown).toContain("### id (path, required)");
      expect(markdown).toContain('{"type":"object","properties":{"name":{"type":"string"}}}');
      expect(markdown).toContain('{"name":"demo"}');
      expect(markdown).toContain("## Request example\n\n```bash\ncurl");
      expect(markdown).toContain("### 201\n\nCreated");
      expect(markdown).toContain("Example:\n\n```json\nfalse\n```");
      expect(markdown).toContain("### 204\n\nNo content");
      expect(markdown).not.toContain("$ref");
      expect(() => pageMarkdown({ docsRoot: fixture.docsRoot, slug: "missing" })).toThrow(
        "Cannot export unresolved OpenAPI operation",
      );
    } finally {
      fixture.dispose();
    }
  });
});

describe("when an API operation has no description", () => {
  /** @scenario "Open an undescribed API operation with a sentence naming its endpoint" */
  it("follows the title with a sentence naming the method and path", () => {
    const fixture = docsFixture({
      config: {},
      pages: { "api.mdx": "---\ntitle: Delete trace\nopenapi: DELETE /traces/{id}\n---\n" },
      main: {
        servers: [{ url: "https://api.example.com/v1" }],
        paths: { "/traces/{id}": { delete: { responses: { "204": { description: "Gone" } } } } },
      },
    });
    try {
      expect(pageMarkdown({ docsRoot: fixture.docsRoot, slug: "api" })).toContain(
        "# Delete trace\n\nDelete trace: DELETE /v1/traces/{id} in the LangWatch REST API.",
      );
    } finally {
      fixture.dispose();
    }
  });
});

describe("when an object schema restates its additionalProperties per property", () => {
  /** @scenario "State a repeated property schema once in API exports" */
  it("keeps only the required and the distinct properties", () => {
    const shared = { type: "array", items: { type: "string" } };
    const schema = {
      type: "object",
      required: ["b"],
      propertyNames: { enum: ["a", "b", "c", "d"] },
      additionalProperties: shared,
      properties: { a: shared, b: shared, c: { type: "number" }, d: shared },
    };
    expect(readableSchema({ schema: { anyOf: [schema] } })).toEqual({
      anyOf: [
        {
          type: "object",
          required: ["b"],
          propertyNames: { enum: ["a", "b", "c", "d"] },
          additionalProperties: shared,
          properties: { b: shared, c: { type: "number" } },
        },
      ],
    });
  });
});

describe("when a guide declares its title and description", () => {
  /** @scenario "Preserve guide metadata in Markdown exports" */
  it("includes metadata before the readable source and its code", () => {
    const body = "## Setup\n\nUse a project key.\n\n```bash\nnpx langwatch claude\n```";
    const fixture = docsFixture({
      config: {},
      pages: {
        "guide.mdx": `---\ntitle: Agent setup\ndescription: Connect your coding agent.\n---\n${body}`,
      },
    });
    try {
      expect(pageMarkdown({ docsRoot: fixture.docsRoot, slug: "guide" })).toBe(
        `# Agent setup\n\nConnect your coding agent.\n\n> Page: https://langwatch.ai/docs/guide\n> Source: https://github.com/langwatch/langwatch/blob/main/docs/guide.mdx\n> Index of all pages: https://langwatch.ai/docs/llms.txt\n\n${body}\n`,
      );
    } finally {
      fixture.dispose();
    }
  });
});

describe("when docs.json gives agents Markdown instructions", () => {
  /** @scenario "Give agents the site's instructions in every Markdown export" */
  it("opens the export with them, before the title, as Mintlify does", () => {
    const fixture = docsFixture({
      config: {
        markdown: { instructions: "Report problems with `npx langwatch report`.\nThanks." },
      },
      pages: { "guide.mdx": "---\ntitle: Agent setup\n---\nBody" },
    });
    try {
      const markdown = pageMarkdown({ docsRoot: fixture.docsRoot, slug: "guide" });
      expect(
        markdown.startsWith(
          "> ## Agent Instructions\n> Report problems with `npx langwatch report`.\n> Thanks.\n\n# Agent setup\n",
        ),
      ).toBe(true);
      expect(agentInstructions({ docsRoot: fixture.docsRoot })).toContain("## Agent Instructions");
      expect(
        pageMarkdown({ docsRoot: fixture.docsRoot, slug: "guide", instructions: "" }).startsWith(
          "# Agent setup",
        ),
      ).toBe(true);
    } finally {
      fixture.dispose();
    }
  });
});

/** Every fenced code block in a source, byte for byte; a longer run of backticks closes one. */
function fencedBlocks({ source }: { source: string }) {
  return [...source.matchAll(/^(`{3,})[^\n]*\n[\s\S]*?\n\1`*[ \t]*$/gm)].map((match) => match[0]);
}

describe("when a guide imports snippets", () => {
  /** @scenario "Export complete guides with their snippets" */
  it("inlines an own-line snippet and keeps code, unknown components and odd usages", () => {
    const fixture = docsFixture({
      config: {},
      pages: {
        "snippets/setup.mdx":
          "---\ntitle: ignored\n---\n<Tip>Install it.</Tip>\n\n```sh\npip install langwatch\n```",
        "snippets/inline.mdx": "inline text",
        "guide.mdx": [
          'import Setup from "/snippets/setup.mdx";',
          'import Inline from "/snippets/inline.mdx";',
          'import Gone from "/snippets/gone.mdx";',
          "",
          "See [quick start](/integration/quick-start) and [anchor](#here) and [external](https://x.dev/a).",
          "",
          "<Setup />",
          "",
          "Text with <Inline /> mid-sentence and <Gone />.",
          "",
          "<Unknown prop={1}>kept</Unknown>",
          "",
          "```mdx",
          'import Setup from "/snippets/setup.mdx";',
          "<Setup />",
          "[raw](/stays-relative)",
          "```",
        ].join("\n"),
      },
    });
    try {
      const markdown = pageMarkdown({ docsRoot: fixture.docsRoot, slug: "guide" });
      expect(markdown).toContain("> **Tip:** Install it.\n\n```sh\npip install langwatch\n```");
      expect(markdown).not.toContain("title: ignored");
      expect(markdown.split("```mdx")[0]).not.toMatch(/^import Setup/m);
      expect(markdown.split("```mdx")[0]).not.toContain("import ");
      expect(markdown).toContain("Text with <Inline /> mid-sentence and <Gone />.");
      expect(markdown).toContain(
        "[quick start](https://langwatch.ai/docs/integration/quick-start)",
      );
      expect(markdown).toContain("[anchor](#here) and [external](https://x.dev/a)");
      expect(markdown).toContain("<Unknown prop={1}>kept</Unknown>");
      expect(markdown).toContain(
        '```mdx\nimport Setup from "/snippets/setup.mdx";\n<Setup />\n[raw](/stays-relative)\n```',
      );
    } finally {
      fixture.dispose();
    }
  });

  /** @scenario "Export complete guides with their snippets" */
  it("exports real guides with their snippet content and every code block intact", () => {
    for (const { slug, snippet } of [
      { slug: "concepts", snippet: "agent-report-notice" },
      { slug: "api-reference/evaluators/overview", snippet: "evaluators-list" },
    ]) {
      const source = readFileSync(path.join(docsRoot, `${slug}.mdx`), "utf8");
      const markdown = pageMarkdown({ docsRoot, slug });
      const snippetSource = readFileSync(path.join(docsRoot, `snippets/${snippet}.mdx`), "utf8");
      const snippetMarkdown = mdxToMarkdown({
        source: withoutFrontmatter({ source: snippetSource }),
      });
      expect(markdown).toContain(snippetMarkdown.trim().split("\n")[0] ?? "");
      expect(markdown).not.toContain(`/snippets/${snippet}.mdx`);
      for (const block of fencedBlocks({ source })) expect(markdown).toContain(block);
    }
  });
});

/** The export of an authored body, without the title and provenance lines. */
function converted({ body }: { body: string }) {
  return mdxToMarkdown({ source: body }).trim();
}

describe("when a guide holds callouts", () => {
  /** @scenario "Export callouts as labelled blockquotes" */
  it("writes a Tip as a quoted, labelled paragraph", () => {
    expect(converted({ body: "<Tip>\n  Use a key.\n  It is free.\n</Tip>" })).toBe(
      "> **Tip:** Use a key.\n> It is free.",
    );
  });

  /** @scenario "Export callouts as labelled blockquotes" */
  it("writes a Note whose content opens with a list with the label on its own line", () => {
    expect(converted({ body: "<Note>\n- one\n- two\n</Note>" })).toBe(
      "> **Note:**\n>\n> - one\n> - two",
    );
  });

  /** @scenario "Export callouts as labelled blockquotes" */
  it("writes an Info inline in the paragraph it was authored in", () => {
    expect(converted({ body: "<Info>Self-hosted only.</Info>" })).toBe(
      "> **Info:** Self-hosted only.",
    );
  });

  /** @scenario "Export callouts as labelled blockquotes" */
  it("leaves the code of a Warning unquoted and untouched", () => {
    const body =
      '<Warning>\n  Rotate it:\n\n  ```bash title="x"\n  npx langwatch login\n  ```\n</Warning>';
    expect(converted({ body })).toBe(
      '**Warning:** Rotate it:\n\n```bash title="x"\nnpx langwatch login\n```',
    );
  });

  /** @scenario "Export callouts as labelled blockquotes" */
  it("writes a Check as a labelled quote", () => {
    expect(converted({ body: "<Check>Traces arrive.</Check>" })).toBe(
      "> **Check:** Traces arrive.",
    );
  });
});

describe("when a guide holds tabs or code groups", () => {
  /** @scenario "Export tabs and code groups as labelled blocks" */
  it("writes each Tab's title in bold before its content", () => {
    const body = [
      "<Tabs>",
      '  <Tab title="Python">',
      "    ```python",
      "    import langwatch",
      "    ```",
      "  </Tab>",
      '  <Tab title="TypeScript">',
      "    Install `langwatch`.",
      "  </Tab>",
      "</Tabs>",
    ].join("\n");
    expect(converted({ body })).toBe(
      "**Python**\n\n```python\nimport langwatch\n```\n\n**TypeScript**\n\nInstall `langwatch`.",
    );
  });

  /** @scenario "Export tabs and code groups as labelled blocks" */
  it("labels each CodeGroup block by its title, else its language, fence untouched", () => {
    const body =
      "<CodeGroup>\n```bash npm\nnpm i langwatch\n```\n\n```python\npass\n```\n</CodeGroup>";
    expect(converted({ body })).toBe(
      "**npm**\n\n```bash npm\nnpm i langwatch\n```\n\n**Python**\n\n```python\npass\n```",
    );
  });

  /** @scenario "Export tabs and code groups as labelled blocks" */
  it("labels a CodeGroupItem by its title", () => {
    const body =
      '<CodeGroup>\n<CodeGroupItem title="Shell">\n```sh\nls\n```\n</CodeGroupItem>\n</CodeGroup>';
    expect(converted({ body })).toBe("**Shell**\n\n```sh\nls\n```");
  });
});

describe("when a guide holds steps", () => {
  /** @scenario "Export steps as numbered headings" */
  it("numbers each Step as a heading below its section", () => {
    const body =
      '## Setup\n\n<Steps>\n  <Step title="Install">\n    Run it.\n  </Step>\n  <Step>\n    Done.\n  </Step>\n</Steps>';
    expect(converted({ body })).toBe(
      "## Setup\n\n### 1. Install\n\nRun it.\n\n### 2. Step 2\n\nDone.",
    );
  });
});

describe("when a guide holds cards", () => {
  /** @scenario "Export cards as a link list" */
  it("writes each Card as one list item linking its title", () => {
    const body = [
      "<CardGroup cols={2}>",
      '  <Card title="Python" icon="python" href="/integration/python">',
      "    Trace a Python app.",
      "  </Card>",
      '  <Card title="Go" description="Trace a Go app." />',
      "</CardGroup>",
    ].join("\n");
    expect(converted({ body })).toBe(
      "- [Python](/integration/python): Trace a Python app.\n- **Go**: Trace a Go app.",
    );
  });
});

describe("when a guide holds fields", () => {
  /** @scenario "Export parameter and response fields as tables" */
  it("writes consecutive ParamFields as one table", () => {
    const body = [
      '<ParamField query="limit" type="number" default="10">',
      "  How many | at most.",
      "</ParamField>",
      '<ParamField path="id" type="string" required>',
      "  The trace.",
      "</ParamField>",
    ].join("\n");
    expect(converted({ body })).toBe(
      [
        "| Name | Type | Required | Description |",
        "| --- | --- | --- | --- |",
        "| `limit` (query) | `number` | no | How many \\| at most. Default: `10`. |",
        "| `id` (path) | `string` | yes | The trace. |",
      ].join("\n"),
    );
  });

  /** @scenario "Export parameter and response fields as tables" */
  it("writes a ResponseField's expandable children as rows named under it", () => {
    const body = [
      '<ResponseField name="trace" type="object">',
      "  The trace.",
      '  <Expandable title="properties">',
      '    <ResponseField name="id" type="string">Its id.</ResponseField>',
      "  </Expandable>",
      "</ResponseField>",
    ].join("\n");
    expect(converted({ body })).toBe(
      [
        "| Name | Type | Required | Description |",
        "| --- | --- | --- | --- |",
        "| `trace` | `object` | no | The trace. |",
        "| `trace.id` | `string` | no | Its id. |",
      ].join("\n"),
    );
  });

  /** @scenario "Export parameter and response fields as tables" */
  it("writes a field holding code as a labelled block", () => {
    const body =
      '<ParamField body="query" type="string" required>\n  ```sql\n  SELECT 1\n  ```\n</ParamField>';
    expect(converted({ body })).toBe(
      "**`query`** (string, body, required)\n\n```sql\nSELECT 1\n```",
    );
  });
});

describe("when a guide holds accordions", () => {
  /** @scenario "Export accordions as headings" */
  it("writes each Accordion of a group as a heading below its section", () => {
    const body =
      '## FAQ\n\n<AccordionGroup>\n  <Accordion title="Why?">\n    Because.\n  </Accordion>\n</AccordionGroup>';
    expect(converted({ body })).toBe("## FAQ\n\n### Why?\n\nBecause.");
  });
});

describe("when a guide holds media", () => {
  /** @scenario "Export frames, images and media as Markdown" */
  it("writes a Frame's image as a Markdown image and its caption in italics", () => {
    const body =
      '<Frame caption="The trace view">\n  <img src="/images/trace.webp" alt="Trace" />\n</Frame>';
    expect(converted({ body })).toBe("![Trace](/images/trace.webp)\n\n*The trace view*");
  });

  /** @scenario "Export frames, images and media as Markdown" */
  it("writes a video as a link to its source", () => {
    const body = '<video controls>\n  <source src="/videos/demo.mp4" type="video/mp4" />\n</video>';
    expect(converted({ body })).toBe("[Video](/videos/demo.mp4)");
  });

  /** @scenario "Export frames, images and media as Markdown" */
  it("writes an iframe as a link to its source", () => {
    const body =
      '<iframe src="https://www.youtube.com/embed/x" title="Demo" style={{ width: "100%" }} />';
    expect(converted({ body })).toBe("[Demo](https://www.youtube.com/embed/x)");
  });
});

describe("when a guide holds inline components", () => {
  /** @scenario "Export inline components as their text" */
  it("keeps a Tooltip's text", () => {
    expect(converted({ body: 'A <Tooltip tip="Time to first token">TTFT</Tooltip> chart.' })).toBe(
      "A TTFT chart.",
    );
  });

  /** @scenario "Export inline components as their text" */
  it("drops an Icon", () => {
    expect(converted({ body: 'Click <Icon icon="gear" /> settings.' })).toBe("Click  settings.");
  });

  /** @scenario "Export inline components as their text" */
  it("writes an Expandable outside a field as its labelled content", () => {
    expect(converted({ body: '<Expandable title="More">\n  Detail.\n</Expandable>' })).toBe(
      "**More**\n\nDetail.",
    );
  });

  /** @scenario "Export inline components as their text" */
  it("keeps LegacyContent and plain wrappers as their content", () => {
    const body =
      '<LegacyContent>\n  <div className="x" style={{ gap: 1 }}>\n    Kept{" "}text.\n  </div>\n</LegacyContent>';
    expect(converted({ body })).toBe("Kept text.");
  });

  /** @scenario "Export inline components as their text" */
  it("writes AgentActions as its two links", () => {
    expect(converted({ body: "<AgentActions />" })).toBe(
      "[Launch your agent](#getting-started) · [Follow the quickstart](/coding-agents/quickstart)",
    );
  });
});

describe("when a guide holds MDX statements and comments", () => {
  /** @scenario "Export complete guides with their snippets" */
  it("drops import and export lines and comments, even one holding a fence", () => {
    const body = [
      'import { X } from "./x";',
      "export const meta = { a: 1 };",
      "Kept.",
      "{/* hidden",
      "```bash",
      "secret",
      "```",
      "*/}",
      "Also {/* inline */}kept.",
      "```mdx",
      "{/* in code */}",
      "```",
    ].join("\n");
    expect(converted({ body })).toBe("Kept.\nAlso kept.\n```mdx\n{/* in code */}\n```");
  });
});

describe("when a skills page holds generated skill cards", () => {
  /** @scenario "Export skill cards as commands and a link to the prompt" */
  it("writes each card as its commands and a link to its prompt file", () => {
    const prompt = "Instrument my code\n\n```bash\nnpx langwatch\n```";
    const body = [
      "## Core Skills",
      "",
      '<div className="lw-accordion">',
      '  <span className="lw-accordion-title">Instrument my code</span>',
      '  <div className="lw-accordion-cmd-box"><code>npx skills add langwatch/skills/tracing</code></div>',
      '  <div className="lw-accordion-cmd-box"><code><span>/tracing</span></code></div>',
      '  <div className="lw-prompt-source">',
      "",
      "````text",
      prompt,
      "````",
      "",
      "  </div>",
      "</div>",
    ].join("\n");
    expect(converted({ body })).toBe(
      [
        "## Core Skills",
        "",
        "### Instrument my code",
        "",
        "- Install via CLI: `npx skills add langwatch/skills/tracing`",
        "- Skill command: `/tracing`",
        `- Full prompt: https://langwatch.ai/docs/${promptFileName({ prompt })}`,
      ].join("\n"),
    );
  });

  /** @scenario "Export skill cards as commands and a link to the prompt" */
  it("writes a SkillCard element the same way", () => {
    const body =
      '<SkillCard title="Trace" install="npx skills add a" command="/a" prompt="Do it." />';
    expect(converted({ body })).toBe(
      `## Trace\n\n- Install via CLI: \`npx skills add a\`\n- Skill command: \`/a\`\n- Full prompt: https://langwatch.ai/docs/${promptFileName({ prompt: "Do it." })}`,
    );
  });
});

describe("when the renderer registers components", () => {
  /** @scenario "Every registered component has a Markdown export" */
  it("has a converter for every capitalised name", () => {
    const registered = Object.keys(mdxComponents).filter((name) => /^[A-Z]/.test(name));
    expect(registered.filter((name) => !MARKDOWN_COMPONENTS.includes(name))).toEqual([]);
  });
});
