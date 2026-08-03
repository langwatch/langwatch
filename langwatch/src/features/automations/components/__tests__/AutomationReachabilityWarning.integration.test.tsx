/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AutomationReachabilityDiagnostic } from "~/server/app-layer/automations/automation-reachability";
import { AutomationReachabilityWarning } from "../AutomationReachabilityWarning";

const diagnostic: AutomationReachabilityDiagnostic = {
  status: "unreachable",
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

  it("describes the matching reason when diagnostics contain multiple fields", () => {
    const mixedDiagnostic: AutomationReachabilityDiagnostic = {
      status: "unreachable",
      reasons: [
        {
          code: "unsupported_structured_fields",
          fields: ["metadata.key"],
        },
        {
          code: "invalid_evaluation_state",
          fields: ["evaluations.state"],
        },
      ],
    };

    render(
      <ChakraProvider value={defaultSystem}>
        <AutomationReachabilityWarning diagnostic={mixedDiagnostic} />
      </ChakraProvider>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("configured evaluations.state");
    expect(alert.textContent).not.toContain("configured metadata.key");
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
