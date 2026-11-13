import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { agentPrompt } from "../model/codegen.ts";
import { operationSchema } from "../model/operation-schema.ts";
import { EndpointStateProvider } from "../ui/endpoint-state.tsx";
import { Playground } from "../ui/playground.tsx";

const operation = operationSchema.parse({
  method: "POST",
  path: "/api/traces/search",
  origin: "https://app.langwatch.ai",
  summary: "Search traces for a project.",
  description: "",
  deprecated: false,
  schemes: [{ id: "api_key", type: "apiKey", in: "header", name: "X-Auth-Token" }],
  parameters: [],
  body: { required: true, description: "", contents: [] },
  responses: [],
});

describe("the agent prompt example", () => {
  /** @scenario "Hand a coding agent a prompt for the request" */
  it("leads the example tabs while Python stays selected", () => {
    const html = renderToStaticMarkup(
      <DesignSystemTestProvider>
        <EndpointStateProvider operation={operation}>
          <Playground operation={operation} slug="api-reference/traces/search" />
        </EndpointStateProvider>
      </DesignSystemTestProvider>,
    );
    const strip = html.slice(html.indexOf('aria-label="Request example"'));
    const tabs = [...strip.matchAll(/<button[^>]*role="tab"[^>]*>[\s\S]*?<\/button>/g)]
      .map((match) => match[0])
      .slice(0, 4);
    const text = (tag: string) => tag.replace(/<[^>]+>/g, "");
    expect(tabs.map(text).map((label) => label.replace(/\d+$/, ""))).toEqual([
      "Agent prompt",
      "Python",
      "TypeScript",
      "curl",
    ]);
    expect(tabs.filter((tag) => /aria-selected="true"/.test(tag)).map(text)).toEqual([
      expect.stringContaining("Python"),
    ]);
    expect(strip).toContain('data-docs-example="agent"');
  });

  /** @scenario "Hand a coding agent a prompt for the request" */
  it("names the call, its reference and the key's environment variable", () => {
    const prompt = agentPrompt({
      operation,
      state: { body: '{"query":"refunds"}', values: {} },
      reference: "https://langwatch.ai/docs/api-reference/traces/search.md",
    });
    expect(prompt).toContain("Search traces for a project.");
    expect(prompt).toContain("Request: POST https://app.langwatch.ai/api/traces/search");
    expect(prompt).toContain("Reference: https://langwatch.ai/docs/api-reference/traces/search.md");
    expect(prompt).toContain("X-Auth-Token header");
    expect(prompt).toContain("LANGWATCH_API_KEY");
    expect(prompt).toContain('"query": "refunds"');
  });
});
