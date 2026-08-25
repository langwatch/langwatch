import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ManagedModelProviderAlert } from "../src";

describe("ManagedModelProviderAlert", () => {
  it("renders the managed provider and validation error", () => {
    const markup = renderToStaticMarkup(
      <ChakraProvider value={defaultSystem}>
        <ManagedModelProviderAlert
          provider={{ provider: "azure" }}
          error="Credentials are unavailable"
        />
      </ChakraProvider>,
    );

    expect(markup).toContain("azure provider credentials");
    expect(markup).toContain("Credentials are unavailable");
  });
});
