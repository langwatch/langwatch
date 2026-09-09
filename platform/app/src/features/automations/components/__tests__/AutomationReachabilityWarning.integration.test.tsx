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

  describe("given an unreachable automation diagnostic", () => {
    describe("when the full warning renders", () => {
      it("shows a field-only operator warning", () => {
        renderWarning();

        const alert = screen.getByRole("alert");
        expect(alert.textContent).toContain("Conditions cannot match");
        expect(alert.textContent).toContain("spanType, size");
      });
    });

    describe("when the compact warning renders", () => {
      it("shows a compact cannot-fire badge in table rows", () => {
        renderWarning(true);

        expect(screen.getByText("Cannot fire")).toBeDefined();
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });
  });

  describe("given mixed diagnostic reasons", () => {
    describe("when the full warning renders", () => {
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
        expect(alert.textContent).toContain("evaluations.state");
        expect(alert.textContent).not.toContain("metadata.key");
      });
    });
  });

  describe("given a reachable automation", () => {
    describe("when the warning renders", () => {
      it("renders nothing", () => {
        const { container } = render(
          <ChakraProvider value={defaultSystem}>
            <AutomationReachabilityWarning diagnostic={null} />
          </ChakraProvider>,
        );

        expect(container.textContent).toBe("");
      });
    });
  });
});
