/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationReachabilityWarning } from "../AutomationReachabilityWarning";

const diagnostic = {
  status: "unreachable" as const,
  reasons: [
    {
      code: "unsupported_filter_query_fields",
      fields: ["spanType", "size"],
    },
  ],
};

function renderWarning(compact = false) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AutomationReachabilityWarning
        diagnostic={diagnostic}
        compact={compact}
      />
    </ChakraProvider>,
  );
}

describe("AutomationReachabilityWarning", () => {
  afterEach(cleanup);

  it("shows a field-only operator warning", () => {
    renderWarning();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Conditions cannot match");
    expect(alert.textContent).toContain("spanType, size");
  });

  it("shows a compact cannot-fire badge in table rows", () => {
    renderWarning(true);

    expect(screen.getByText("Cannot fire")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing for a reachable automation", () => {
    const { container } = render(
      <ChakraProvider value={defaultSystem}>
        <AutomationReachabilityWarning diagnostic={null} />
      </ChakraProvider>,
    );

    expect(container.textContent).toBe("");
  });
});
