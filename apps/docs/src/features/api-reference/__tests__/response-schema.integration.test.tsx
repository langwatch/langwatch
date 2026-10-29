import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Operation } from "../model/operation.ts";
import { Responses } from "../ui/reference.tsx";

describe("when API responses use root arrays and composed schemas", () => {
  /** @scenario "Render response arrays and composed schemas" */
  it("renders item properties, union branches, composed fields and every media type", () => {
    const operation: Operation = {
      method: "GET",
      path: "/prompts",
      origin: "https://app.langwatch.ai",
      summary: "List prompts",
      description: "",
      deprecated: false,
      schemes: [],
      parameters: [],
      body: null,
      responses: [
        {
          status: "200",
          description: "Prompts",
          contents: [
            {
              type: "application/json",
              schema: {
                type: "array",
                items: {
                  allOf: [
                    {
                      type: "object",
                      properties: { promptVersion: { type: "integer", default: 1, minimum: 1 } },
                      required: ["promptVersion"],
                    },
                    { type: "object", properties: { promptHandle: { type: "string" } } },
                  ],
                },
              },
            },
            {
              type: "application/problem+json",
              schema: {
                oneOf: [
                  { type: "object", properties: { retryAfter: { type: "integer" } } },
                  { type: "object", properties: { reasonCode: { type: "string" } } },
                ],
              },
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <DesignSystemTestProvider>
        <Responses operation={operation} />
      </DesignSystemTestProvider>,
    );
    expect(html).toContain("promptVersion");
    expect(html).toContain("Default:");
    expect(html).toContain("Minimum 1");
    expect(html).toContain("promptHandle");
    expect(html).toContain("required");
    expect(html).toContain("retryAfter");
    expect(html).toContain("reasonCode");
    expect(html).toContain("One of 2");
    expect(html).toContain("Option 1");
    expect(html).toContain("Option 2");
    expect(html).toContain("application/problem+json");
  });
});

describe("when a response nests objects and discriminated unions", () => {
  const operation: Operation = {
    method: "GET",
    path: "/facets",
    origin: "https://app.langwatch.ai",
    summary: "Facets",
    description: "",
    deprecated: false,
    schemes: [],
    parameters: [],
    body: null,
    responses: [
      {
        status: "200",
        description: "Without `field`, every facet.",
        contents: [
          {
            type: "application/json",
            schema: {
              type: "object",
              properties: {
                facets: {
                  type: "array",
                  items: {
                    anyOf: [
                      {
                        type: "object",
                        properties: {
                          kind: { type: "string", const: "categorical" },
                          key: { type: "string" },
                        },
                      },
                      {
                        type: "object",
                        properties: { kind: { type: "string", const: "range" } },
                      },
                    ],
                  },
                },
                page: {
                  type: "object",
                  properties: { total: { type: "number" }, hasMore: { type: "boolean" } },
                },
                cursor: { type: "object", properties: { next: { type: "string" } } },
              },
            },
          },
        ],
      },
    ],
  };
  /* Emotion writes its style tags inline, beside the elements they style: keep only the markup. */
  const html = renderToStaticMarkup(
    <DesignSystemTestProvider>
      <Responses operation={operation} />
    </DesignSystemTestProvider>,
  )
    .split(/<style[^>]*>|<\/style>/)
    .filter((_, index) => index % 2 === 0)
    .join("");

  /** @scenario "Render nested objects and union options as connected groups" */
  it("counts every child disclosure and names union options by their constant", () => {
    expect(html).toContain("Show 2 variants");
    expect(html).toContain("Show 2 child attributes");
    expect(html).toContain("Show 1 child attribute<");
    expect(html).not.toContain("nested child attributes");
    expect(html).toContain("kind: &quot;categorical&quot;");
    expect(html).toContain("kind: &quot;range&quot;");
  });

  /** @scenario "Render code spans in API descriptions" */
  it("renders backticked words in a description as inline code", () => {
    expect(html).toContain("Without <code");
    expect(html).toMatch(/>field<\/code>, every facet\./);
    expect(html).not.toContain("`field`");
  });
});
