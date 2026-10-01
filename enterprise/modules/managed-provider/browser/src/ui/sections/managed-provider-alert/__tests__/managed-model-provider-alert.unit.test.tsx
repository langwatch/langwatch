import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { describe, expect, it } from "vitest";

import { ManagedModelProviderAlert } from "../index.ts";

describe("ManagedModelProviderAlert", () => {
  it("renders the managed provider and validation error", () => {
    const { container } = renderWithDesignSystem(
      <ManagedModelProviderAlert
        provider={{ provider: "azure" }}
        error="Credentials are unavailable"
      />,
    );
    const markup = container.innerHTML;

    expect(markup).toContain("azure provider credentials");
    expect(markup).toContain("Credentials are unavailable");
  });
});
