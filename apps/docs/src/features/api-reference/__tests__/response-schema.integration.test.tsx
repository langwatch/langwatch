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
    expect(html).toContain("Option 1:");
    expect(html).toContain("Option 2:");
    expect(html).toContain("application/problem+json");
  });
});
