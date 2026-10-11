import { describe, expect, it } from "vitest";

import { docsFixture } from "../../../testing/docs-fixture.ts";
import { pageMarkdown } from "../compile/markdown-export.ts";

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
        `# Agent setup\n\nConnect your coding agent.\n\n${body}\n`,
      );
    } finally {
      fixture.dispose();
    }
  });
});
