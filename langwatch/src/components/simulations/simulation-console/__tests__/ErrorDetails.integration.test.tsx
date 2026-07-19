/**
 * @vitest-environment jsdom
 *
 * Integration tests for ErrorDetails — the run drawer's error block.
 * Verifies infra failures render as a clean, actionable handled error and
 * never leak a raw stack trace, whatever shape the stored error takes.
 *
 * @see specs/scenarios/scenario-infra-error-surfacing.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyScenarioInfraError,
  encodeScenarioError,
} from "~/server/scenarios/scenario-infra-error";
import { ErrorDetails } from "../ErrorDetails";

function renderError(error: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ErrorDetails error={error} />
    </ChakraProvider>,
  );
}

// The real serialized error the scenario SDK stores for a self-signed cert
// failure (captured from Grafana): a JSON `{ name, message, stack }` whose stack
// is a long dump the user must never see.
const SDK_CERT_ERROR = JSON.stringify({
  name: "Error",
  message:
    "[UserSimulatorAgent] AI_RetryError: Failed after 3 attempts. Last error: Cannot connect to API: self-signed certificate in certificate chain",
  stack:
    "Error: [UserSimulatorAgent] AI_RetryError...\n    at ScenarioExecution.callAgent (/node_modules/@langwatch/scenario/dist/index.js:4209:13)\n    at process.processTicksAndRejections",
});

describe("<ErrorDetails />", () => {
  afterEach(cleanup);

  describe("given the SDK's serialized {name,message,stack} cert error", () => {
    /** @scenario "The drawer renders the handled error, not a raw dump" */
    it("renders the handled-error title and actionable hint", () => {
      renderError(SDK_CERT_ERROR);
      expect(screen.getByText("Secure connection failed")).toBeDefined();
      expect(
        screen.getByTestId("scenario-handled-error-hint").textContent,
      ).toMatch(/certificate authority|NODE_EXTRA_CA_CERTS/i);
    });

    it("never renders the raw stack trace", () => {
      const { container } = renderError(SDK_CERT_ERROR);
      expect(container.textContent).not.toContain("processTicksAndRejections");
      expect(container.textContent).not.toContain("node_modules");
      expect(container.textContent).not.toMatch(/Stack Trace/i);
    });
  });

  describe("given an already-encoded handled-error envelope", () => {
    it("renders it directly", () => {
      const encoded = encodeScenarioError(
        classifyScenarioInfraError("connect ECONNREFUSED 127.0.0.1:443"),
      );
      renderError(encoded);
      expect(screen.getByText("Couldn't reach the endpoint")).toBeDefined();
    });
  });

  describe("given a plain unrecognised error string", () => {
    it("shows the generic handled title and preserves the message", () => {
      renderError("Something went sideways");
      expect(screen.getByText("Simulation failed")).toBeDefined();
      expect(screen.getByText("Something went sideways")).toBeDefined();
    });
  });
});
