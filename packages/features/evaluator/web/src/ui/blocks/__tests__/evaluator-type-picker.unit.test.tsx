/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluatorTypePicker } from "../evaluator-type-picker";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
});

describe("EvaluatorTypePicker", () => {
  describe("given the expected_answer category", () => {
    /** @scenario Each category contains specific evaluators */
    /** @scenario EvaluatorTypeSelectorDrawer shows evaluators in category */
    it("shows evaluators for the selected category", async () => {
      render(<EvaluatorTypePicker category="expected_answer" onSelect={vi.fn()} />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(screen.getByText(/Exact Match/)).toBeInTheDocument();
      });
      expect(screen.getByText(/matches the expected_output exactly/i)).toBeInTheDocument();
      // Other categories' evaluators do not leak into this one.
      expect(screen.queryByText(/Content Safety/)).not.toBeInTheDocument();
    });
  });

  describe("when selecting an evaluator", () => {
    /** @scenario Select evaluator type opens editor */
    it("calls onSelect with the chosen evaluator type", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<EvaluatorTypePicker category="expected_answer" onSelect={onSelect} />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(screen.getByText(/Exact Match/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Exact Match/));

      expect(onSelect).toHaveBeenCalledWith("langevals/exact_match");
    });
  });

  describe("given the project has no azure_safety provider configured", () => {
    const missingEnvVars = ["AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"];
    const availability = {
      "azure/content_safety": { missingEnvVars },
      "azure/prompt_injection": { missingEnvVars },
      "azure/jailbreak": { missingEnvVars },
      "presidio/pii_detection": { missingEnvVars: [] },
    };

    /** @scenario Azure evaluators are disabled when no Azure Safety provider is configured */
    it("disables all three Azure evaluator cards", async () => {
      render(
        <EvaluatorTypePicker category="safety" availability={availability} onSelect={vi.fn()} />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("evaluator-type-azure-content_safety")).toHaveAttribute(
          "data-disabled",
          "true",
        );
      });
      expect(screen.getByTestId("evaluator-type-azure-prompt_injection")).toHaveAttribute(
        "data-disabled",
        "true",
      );
      expect(screen.getByTestId("evaluator-type-azure-jailbreak")).toHaveAttribute(
        "data-disabled",
        "true",
      );
    });

    /** @scenario Non-Azure safety evaluators are unaffected by Azure Safety config */
    it("leaves non-Azure safety evaluators enabled and selectable", async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(
        <EvaluatorTypePicker category="safety" availability={availability} onSelect={onSelect} />,
        { wrapper: Wrapper },
      );

      const piiCard = await screen.findByTestId("evaluator-type-presidio-pii_detection");
      expect(piiCard).not.toHaveAttribute("data-disabled");

      await user.click(piiCard);
      expect(onSelect).toHaveBeenCalledWith("presidio/pii_detection");
    });

    describe("when the Configure Azure Safety CTA on a disabled card is clicked", () => {
      /** @scenario Disabled Azure card shows CTA to configure the provider */
      it("calls onConfigureAzureSafety instead of selecting the evaluator", async () => {
        const onConfigureAzureSafety = vi.fn();
        const onSelect = vi.fn();
        const user = userEvent.setup();
        render(
          <EvaluatorTypePicker
            category="safety"
            availability={availability}
            onSelect={onSelect}
            onConfigureAzureSafety={onConfigureAzureSafety}
          />,
          { wrapper: Wrapper },
        );

        const cta = await screen.findByTestId("evaluator-type-azure-content_safety-cta");
        await user.click(cta);

        expect(onConfigureAzureSafety).toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the project has azure_safety configured with valid keys", () => {
    /** @scenario Configuring Azure Safety enables all three Azure evaluators */
    it("leaves all three Azure evaluator cards enabled", async () => {
      render(
        <EvaluatorTypePicker
          category="safety"
          availability={{
            "azure/content_safety": { missingEnvVars: [] },
            "azure/prompt_injection": { missingEnvVars: [] },
            "azure/jailbreak": { missingEnvVars: [] },
          }}
          onSelect={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("evaluator-type-azure-content_safety")).not.toHaveAttribute(
          "data-disabled",
        );
      });
      expect(screen.getByTestId("evaluator-type-azure-prompt_injection")).not.toHaveAttribute(
        "data-disabled",
      );
      expect(screen.getByTestId("evaluator-type-azure-jailbreak")).not.toHaveAttribute(
        "data-disabled",
      );
    });
  });
});
