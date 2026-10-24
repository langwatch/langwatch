/**
 * The HTTP agent test panel's failure alert.
 * @vitest-environment jsdom
 * @see specs/http-test-peers.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { HttpTestPanel } from "../../sections/http-test-panel.tsx";
import { HttpTestResponseDisplay } from "../http-test-response-display.tsx";

afterEach(cleanup);

/** A handled error as it arrives off the wire, with no engine code on a test result. */
const registeredFailure = {
  code: "agent_register_only",
  httpStatus: 409,
  meta: {},
  fault: "customer",
};

describe("the HTTP agent test panel when the test call throws a named failure", () => {
  describe("when the failure is one the registry knows", () => {
    /** @scenario A named failure thrown by the HTTP agent test reads in words on the panel */
    it("shows its title and description", async () => {
      renderWithDesignSystem(
        <HttpTestPanel
          url="https://example.com/chat"
          method="POST"
          bodyTemplate="{}"
          onTest={() => Promise.reject(registeredFailure)}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: /send request/i }));

      expect(await screen.findByText("This agent is registered from code")).toBeDefined();
      expect(screen.getByText(/Change the code and start the process again/)).toBeDefined();
    });
  });

  describe("when the failure is unregistered and its headline holds a sentence break", () => {
    /** @scenario A named failure thrown by the HTTP agent test reads in words on the panel */
    it("keeps the whole headline and the description apart", () => {
      renderWithDesignSystem(
        <HttpTestResponseDisplay
          result={{ success: false }}
          thrownFailure={{
            error: new Error("boom"),
            fallbackTitle: "Request failed. Check the address",
          }}
        />,
      );

      expect(screen.getByText("Request failed. Check the address")).toBeDefined();
      expect(screen.getByText(/We've been notified/)).toBeDefined();
    });
  });

  describe("when the engine returned a code", () => {
    /** @scenario A named failure thrown by the HTTP agent test reads in words on the panel */
    it("keeps the copy the code names", () => {
      renderWithDesignSystem(
        <HttpTestResponseDisplay
          result={{ success: false, error: "Other title. Other words.", errorCode: "http_timeout" }}
          explainError={() => ({ title: "Engine copy", description: "From the code." })}
        />,
      );

      expect(screen.getByText("Engine copy")).toBeDefined();
      expect(screen.queryByText(/Other title/)).toBeNull();
    });
  });
});
