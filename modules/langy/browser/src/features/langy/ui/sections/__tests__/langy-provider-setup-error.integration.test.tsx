/**
 * @vitest-environment jsdom
 * A turn the gateway stopped for a missing provider setting names it and links to the fix.
 * @see specs/langy/langy-model-provider-failures.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  explainLangyError,
  readLangyStreamError,
} from "../../../behavior/logic/langy-error-explainer.ts";
import { LangyError } from "../langy-error.tsx";

/**
 * The turn error as the stream carries it: the worker's own code on top, the
 * gateway's refusal as the reason, with the gateway's meta as it wrote it.
 */
function turnErrorFrame(problem: string | undefined): string {
  return JSON.stringify({
    code: "langy_agent_errored",
    httpStatus: 502,
    meta: {},
    traceId: "2ab7ff6b8f025b66f51978a127f956bb",
    reasons: [
      {
        kind: "provider_config_invalid",
        meta: {
          message:
            'This model provider is not configured to serve "gpt-5.6-terra". sk-should-never-render',
          provider: "openai",
          model: "gpt-5.6-terra",
          ...(problem ? { problem } : {}),
        },
      },
    ],
  });
}

function renderTurnError(problem: string | undefined, onAction?: (kind: string) => void) {
  const presentation = explainLangyError(readLangyStreamError(turnErrorFrame(problem))!);
  render(
    <DesignSystemProvider>
      <LangyError presentation={presentation} onAction={onAction} />
    </DesignSystemProvider>,
  );
  return presentation;
}

describe("Feature: a turn stopped by an incomplete model provider says what to fix", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a provider that was saved without its API key", () => {
    describe("when the turn fails", () => {
      /** @scenario "A provider with no API key saved reads as a key to add" */
      it("says the provider has no API key and links to the provider settings", () => {
        renderTurnError("api_key_missing");

        expect(
          screen.getByText(
            "This model provider is enabled with no API key saved, so the request never reached it. Add the API key in Settings → Model Providers.",
          ),
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Open model providers" })).toHaveAttribute(
          "href",
          "/settings/model-providers",
        );
      });

      /** @scenario "A provider with no API key saved reads as a key to add" */
      it("does not offer a retry that would fail the same way", () => {
        renderTurnError("api_key_missing");

        expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
      });

      /** @scenario "The card never repeats what the gateway or the provider wrote" */
      it("renders none of the reason's own message", () => {
        renderTurnError("api_key_missing");

        expect(document.body.textContent).not.toContain("sk-should-never");
        expect(document.body.textContent).not.toContain("not configured to");
      });
    });

    describe("when the settings link is clicked inside the panel", () => {
      /** @scenario "A provider with no API key saved reads as a key to add" */
      it("hands the move to the panel instead of leaving the page", async () => {
        const onAction = vi.fn();
        renderTurnError("api_key_missing", onAction);

        await userEvent.setup().click(screen.getByRole("link", { name: "Open model providers" }));

        expect(onAction).toHaveBeenCalledWith("configure-model");
      });
    });
  });

  describe("given a provider with no endpoint saved", () => {
    /** @scenario "Each missing provider setting has its own sentence" */
    it("says the endpoint is what is missing", () => {
      renderTurnError("endpoint_missing");

      expect(
        screen.getByText(
          "This model provider has no endpoint URL saved, so there was nowhere to send the request. Add the endpoint in Settings → Model Providers.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("given a provider with no deployment for the model", () => {
    /** @scenario "Each missing provider setting has its own sentence" */
    it("names the model that has no deployment", () => {
      renderTurnError("deployment_missing");

      expect(
        screen.getByText(
          "This model provider has no deployment mapped for gpt-5.6-terra. Add the deployment mapping in Settings → Model Providers.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("given a gateway that names no problem", () => {
    /** @scenario "A provider setup failure with no named problem still points at the settings" */
    it("still reads as a provider to set up, with the settings link", () => {
      const presentation = renderTurnError(undefined);

      expect(presentation.kind).toBe("provider_config_invalid");
      expect(
        screen.getByText(
          "No provider on this project is configured for gpt-5.6-terra. Add it to one in Settings → Model Providers.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open model providers" })).toBeInTheDocument();
    });
  });

  describe("given a problem value this client does not know", () => {
    /** @scenario "The card never repeats what the gateway or the provider wrote" */
    it("does not render it", () => {
      const presentation = renderTurnError("sk-not-a-problem");

      expect(presentation.meta).toEqual({ model: "gpt-5.6-terra" });
      expect(document.body.textContent).not.toContain("sk-not-a-problem");
    });
  });
});
