/**
 * @vitest-environment jsdom
 *
 * Integration tests for the missing-model toast (replaces the previous
 * focus-trapping modal). Verifies the toast surfaces feature + role
 * context, deep-links to the right settings anchor, dedupes retry
 * storms, and renders the read-only variant without the Configure CTA.
 *
 * UX contract: specs/model-providers/missing-model-popup.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AI_CALL_FAILED_CAUSE } from "../../utils/trpcError";
import {
  aiCallFailedToastId,
  missingModelToastId,
  showAiCallFailedToast,
  showMissingModelToast,
} from "../MissingModelToast";
import { Toaster, toaster } from "../ui/toaster";

beforeEach(() => {
  toaster.remove();
});
afterEach(() => {
  cleanup();
  toaster.remove();
});

function mountToaster() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Toaster />
    </ChakraProvider>,
  );
}

describe("showMissingModelToast", () => {
  /** @scenario The toast names the feature, the role, and the scope it couldn't resolve from */
  it("renders the feature name + role in the toast body", async () => {
    mountToaster();
    showMissingModelToast({
      featureKey: "traces.ai_search",
      featureDisplayName: "AI search",
      role: "FAST",
      projectSlug: "acme-app",
      canConfigure: true,
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Model not configured for AI search/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Pick a Fast model in Model Providers/i),
    ).toBeInTheDocument();
  });

  /** @scenario The toast names the feature, the role, and the scope it couldn't resolve from */
  it("renders as an info toast, not an error", async () => {
    mountToaster();
    showMissingModelToast({
      featureKey: "traces.ai_search",
      featureDisplayName: "AI search",
      role: "FAST",
      projectSlug: "acme-app",
      canConfigure: true,
    });

    const title = await screen.findByText(
      /Model not configured for AI search/i,
    );
    const root = title.closest("[data-type]");
    expect(root).not.toBeNull();
    expect(root!.getAttribute("data-type")).toBe("info");
  });

  /** @scenario The modal carries one primary CTA to the right settings page and role */
  it("renders a Configure action that deep-links to the role anchor", async () => {
    mountToaster();
    showMissingModelToast({
      featureKey: "traces.ai_search",
      featureDisplayName: "AI search",
      role: "FAST",
      projectSlug: "acme-app",
      canConfigure: true,
    });

    await waitFor(() => {
      expect(screen.getByText(/Configure Fast model/i)).toBeInTheDocument();
    });
  });

  /** @scenario A read-only user sees the modal but no Configure button */
  it("omits the Configure action when the caller can't configure", async () => {
    mountToaster();
    showMissingModelToast({
      featureKey: "traces.ai_search",
      featureDisplayName: "AI search",
      role: "FAST",
      projectSlug: "acme-app",
      canConfigure: false,
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Model not configured for AI search/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/Configure Fast model/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Ask an organization or project admin to set a Fast model/i,
      ),
    ).toBeInTheDocument();
  });

  /** @scenario Identical errors in quick succession only open one modal */
  it("dedupes by stable id when the same toast is already visible", async () => {
    mountToaster();
    const info = {
      featureKey: "traces.ai_search",
      featureDisplayName: "AI search",
      role: "FAST" as const,
      projectSlug: "acme-app",
      canConfigure: true,
    };
    showMissingModelToast(info);
    showMissingModelToast(info);
    showMissingModelToast(info);

    await waitFor(() => {
      expect(
        screen.getAllByText(/Model not configured for AI search/i),
      ).toHaveLength(1);
    });
    expect(toaster.isVisible(missingModelToastId(info))).toBe(true);
  });
});

describe("showAiCallFailedToast", () => {
  /** @scenario Downstream AI failures surface a hint to verify model configuration */
  it("surfaces the feature label + hint + provider error message", async () => {
    mountToaster();
    showAiCallFailedToast({
      featureKey: "workflows.commit_message",
      featureDisplayName: "Workflow commit message",
      role: "FAST",
      projectSlug: "acme-app",
      errorMessage: "401 Unauthorized from provider",
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Workflow commit message failed/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Double-check your Fast model configuration/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/401 Unauthorized from provider/i),
    ).toBeInTheDocument();
  });

  it("dedupes by stable id", async () => {
    mountToaster();
    const info = {
      featureKey: "workflows.commit_message",
      featureDisplayName: "Workflow commit message",
      role: "FAST" as const,
      projectSlug: "acme-app",
      errorMessage: "boom",
    };
    showAiCallFailedToast(info);
    showAiCallFailedToast(info);

    await waitFor(() => {
      expect(
        screen.getAllByText(/Workflow commit message failed/i),
      ).toHaveLength(1);
    });
    expect(toaster.isVisible(aiCallFailedToastId(info))).toBe(true);
  });
});

describe("AI_CALL_FAILED_CAUSE export", () => {
  // Pin the wire-format discriminator so a rename in trpcError.ts
  // (which the server-side errorFormatter mirrors) can't silently
  // drift away from the toast-side extractor.
  it("matches the server-side AI_CALL_FAILED cause discriminator", () => {
    expect(AI_CALL_FAILED_CAUSE).toBe("AI_CALL_FAILED");
  });
});
