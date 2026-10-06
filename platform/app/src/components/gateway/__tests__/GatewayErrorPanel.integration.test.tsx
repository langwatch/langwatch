/**
 * @vitest-environment jsdom
 *
 * What a gateway list page shows when its query fails.
 *
 * Covers @integration scenarios from specs/ai-gateway/gateway-list-access.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayErrorPanel } from "../GatewayErrorPanel";

const refusal = (permission: string) => ({
  message: "You do not have permission to access this organization",
  data: {
    code: "FORBIDDEN",
    error: {
      code: "permission_denied",
      httpStatus: 403,
      meta: { permission },
    },
  },
});

const renderPanel = (error: unknown) => {
  const onRetry = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <GatewayErrorPanel
        title="Failed to load budgets"
        error={error}
        onRetry={onRetry}
      />
    </ChakraProvider>,
  );
  return { onRetry };
};

describe("Feature: gateway list pages for a viewer without the grant", () => {
  afterEach(() => cleanup());

  describe("given the list was refused for a missing grant", () => {
    /** @scenario A refused gateway list reads as no access, not as a failed load */
    it("names the grant to ask for and offers no retry", () => {
      renderPanel(refusal("gatewayBudgets:view"));

      expect(
        screen.getByText("You don't have permission to do this"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/grant you "gatewayBudgets:view"/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Failed to load budgets"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Retry" }),
      ).not.toBeInTheDocument();
    });

    it("does not repeat the server's own sentence", () => {
      renderPanel(refusal("gatewayCacheRules:view"));

      expect(
        screen.queryByText(/You do not have permission to access this/),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the list failed for any other reason", () => {
    /** @scenario A gateway list that failed to load keeps its retry */
    it("shows the load error with a retry", () => {
      renderPanel({ message: "Gateway unreachable" });

      expect(screen.getByText("Failed to load budgets")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
  });
});
