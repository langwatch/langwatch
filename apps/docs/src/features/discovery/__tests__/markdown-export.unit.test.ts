import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { docsRoot } from "../../../paths.ts";
import { docsFixture } from "../../../testing/docs-fixture.ts";
import { agentInstructions, pageMarkdown } from "../compile/markdown-export.ts";

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
      expect(markdown).toContain('"name": "X-Auth-Token"');
      expect(markdown).toContain("### id (path, required)");
      expect(markdown).toContain('"properties": {\n    "name":');
      expect(markdown).toContain('"name": "demo"');
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

describe("when a guide declares its title and description", () => {
  /** @scenario "Preserve guide metadata in Markdown exports" */
  it("includes metadata while preserving authored MDX and code", () => {
    const body = "## Setup\n\n<Tip>Use a project key.</Tip>\n\n```bash\nnpx langwatch claude\n```";
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

/** Every fenced code block in a source, byte for byte. */
function fencedBlocks({ source }: { source: string }) {
  return [...source.matchAll(/^(`{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm)].map((match) => match[0]);
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
      expect(markdown).toContain("<Tip>Install it.</Tip>\n\n```sh\npip install langwatch\n```");
      expect(markdown).not.toContain("title: ignored");
      expect(markdown.split("```mdx")[0]).not.toMatch(/^import Setup/m);
      expect(markdown).toContain('import Inline from "/snippets/inline.mdx";');
      expect(markdown).toContain('import Gone from "/snippets/gone.mdx";');
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
    for (const [slug, snippet] of [
      ["concepts", "agent-report-notice"],
      ["api-reference/evaluators/overview", "evaluators-list"],
    ]) {
      const source = readFileSync(path.join(docsRoot, `${slug}.mdx`), "utf8");
      const markdown = pageMarkdown({ docsRoot, slug });
      const snippetSource = readFileSync(path.join(docsRoot, `snippets/${snippet}.mdx`), "utf8");
      expect(markdown).toContain(snippetSource.trim().split("\n")[0]);
      expect(markdown).not.toContain(`/snippets/${snippet}.mdx`);
      for (const block of fencedBlocks({ source })) expect(markdown).toContain(block);
    }
  });
});
