import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { operationSchema } from "../model/operation-schema.ts";
import { EndpointStateProvider } from "../ui/endpoint-state.tsx";
import { Playground } from "../ui/playground.tsx";

const operation = operationSchema.parse({
  method: "POST",
  path: "/api/traces/search",
  origin: "https://app.langwatch.ai",
  summary: "Search traces",
  description: "",
  deprecated: false,
  schemes: [{ id: "bearer", type: "http", scheme: "bearer" }],
  parameters: [],
  body: { required: false, description: "", contents: [] },
  responses: [],
});
describe("when the build names no app", () => {
  /** @scenario "Offer only the pasted key when the build names no app" */
  it("offers only the pasted key when the build names no app", () => {
    const html = renderToStaticMarkup(
      <DesignSystemTestProvider>
        <EndpointStateProvider operation={operation}>
          <Playground operation={operation} slug="api-reference/traces/search" />
        </EndpointStateProvider>
      </DesignSystemTestProvider>,
    );
    expect(html).toContain('id="pg-auth"');
    expect(html).not.toContain("data-docs-session");
  });
});
