/**
 * @vitest-environment jsdom
 *
 * Spec: specs/prompts/playground-conversation.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ErrorMessage } from "../error-message.tsx";

afterEach(cleanup);

describe("ErrorMessage", () => {
  describe("when our server refused the run with a code", () => {
    /** @scenario "A model refused for the playground is named in the conversation" */
    it("shows the registry's words for that code, not the generic line", () => {
      renderWithDesignSystem(
        <ErrorMessage
          error={{
            type: "unknown",
            message: "restricted",
            handled: {
              code: "model_restricted_for_execution",
              meta: { model: "openai_codex/gpt-5.6-terra" },
              httpStatus: 400,
              fault: "customer",
              retryable: false,
              tips: [],
              docsUrl: undefined,
              traceId: undefined,
              reasons: [],
            },
          }}
        />,
      );

      expect(screen.getByText("This model can't run here")).toBeTruthy();
      expect(screen.getByText(/licensed for coding-assistant features only/)).toBeTruthy();
      expect(screen.queryByText(/We've been notified/)).toBeNull();
    });
  });

  describe("when the failure carries no code", () => {
    it("shows the generic line", () => {
      renderWithDesignSystem(<ErrorMessage error={{ type: "unknown", message: "boom" }} />);

      expect(screen.getByText(/We've been notified/)).toBeTruthy();
      expect(screen.queryByText("boom")).toBeNull();
    });
  });
});
