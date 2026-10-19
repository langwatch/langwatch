/**
 * @vitest-environment jsdom
 *
 * The error a failed turn draws: a titled, calm explanation keyed on the error kind, and
 * nothing at all for the kinds the panel answers with a card of its own.
 * @see specs/langy/langy-frontend-realtime.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  explainLangyError,
  type LangyDomainError,
} from "../../../behavior/logic/langy-error-explainer.ts";
import { LangyError } from "../langy-error.tsx";

function renderError(error: Partial<LangyDomainError>) {
  const received: LangyDomainError = {
    code: "unknown",
    httpStatus: 500,
    meta: {},
    retryable: false,
    ...error,
  };
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyError presentation={explainLangyError(received)} />
    </DesignSystemProvider>,
  );
}

describe("LangyError", () => {
  describe("given a handled domain error", () => {
    /** @scenario "A handled stream error renders a useful explanation, not a raw string" */
    it("draws a titled explanation for its kind, with the way out", () => {
      renderError({ code: "langy_agent_at_capacity", httpStatus: 429 });

      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText("Langy is busy right now")).toBeTruthy();
      expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
      expect(screen.queryByText("langy_agent_at_capacity")).toBeNull();
    });
  });

  describe("given an error Langy does not recognise", () => {
    /** @scenario "An unknown error stays calm and traceable" */
    it("shows one calm generic message and the trace id to quote", () => {
      renderError({ code: "unknown", traceId: "abc123" });

      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByText("Something went wrong")).toBeTruthy();
      expect(screen.getByText("id: abc123")).toBeTruthy();
      expect(screen.queryByText("unknown")).toBeNull();
    });
  });

  describe("given the turn stopped because GitHub is not connected", () => {
    it("draws no red error, leaving the connect card to the panel", () => {
      renderError({ code: "langy_github_not_connected", httpStatus: 409 });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText(/something went wrong/i)).toBeNull();
    });
  });
});
