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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AI_CALL_FAILED_CAUSE } from "../../utils/trpcError";
import {
  aiCallFailedToastId,
  missingModelToastId,
  type ProviderDisabledInfo,
  providerDisabledToastId,
  showAiCallFailedToast,
  showMissingModelToast,
  showProviderDisabledToast,
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

  /** @scenario A failed assistive AI call warns, it does not error */
  it("renders as a warning toast, not an error", async () => {
    mountToaster();
    showAiCallFailedToast({
      featureKey: "workflows.commit_message",
      featureDisplayName: "Workflow commit message",
      role: "FAST",
      projectSlug: "acme-app",
      errorMessage: "boom",
    });

    const title = await screen.findByText(/Workflow commit message failed/i);
    const root = title.closest("[data-type]");
    expect(root).not.toBeNull();
    expect(root!.getAttribute("data-type")).toBe("warning");
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

function buildProviderDisabledInfo(
  overrides: Partial<ProviderDisabledInfo> = {},
): ProviderDisabledInfo {
  return {
    featureKey: "traces.ai_search",
    featureDisplayName: "AI search",
    role: "DEFAULT",
    projectId: "proj-1",
    resolvedScope: "project",
    resolvedModel: "openai/gpt-4o",
    providerKey: "openai",
    alternate: {
      scope: "organization",
      model: "azure/gpt-4o",
      providerKey: "azure",
      providerEnabled: true,
    },
    ...overrides,
  };
}

describe("showProviderDisabledToast", () => {
  /** @scenario Project-scope override with disabled provider and an org alternate */
  it("names the disabled project default and swaps to the org alternate on click", async () => {
    mountToaster();
    const onSwapToAlternate = vi.fn();
    showProviderDisabledToast(buildProviderDisabledInfo({ onSwapToAlternate }));

    await waitFor(() => {
      expect(
        screen.getByText(/Model unavailable for AI search/i),
      ).toBeInTheDocument();
    });
    // Description names the disabled default + its scope, and offers the
    // cascade-next alternate.
    expect(
      screen.getByText(/openai\/gpt-4o is set at project scope/i),
    ).toBeInTheDocument();
    const swapButton = screen.getByText(
      "Use organization default (azure/gpt-4o)",
    );
    fireEvent.click(swapButton);
    // The click delegates to the injected swap handler — the interceptor
    // wires this to setFeatureOverrideForScope(model: null) at the
    // project scope (see providerDisabledSwapHandler in utils/api.tsx).
    expect(onSwapToAlternate).toHaveBeenCalledTimes(1);
  });

  /** @scenario No alternate falls back to settings deep-link */
  it("offers an Open settings deep-link when the cascade has no alternate", async () => {
    mountToaster();
    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign },
      writable: true,
      configurable: true,
    });
    try {
      showProviderDisabledToast(
        buildProviderDisabledInfo({
          alternate: null,
          onSwapToAlternate: undefined,
        }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(/Model unavailable for AI search/i),
        ).toBeInTheDocument();
      });
      const settingsButton = screen.getByText("Open settings");
      fireEvent.click(settingsButton);
      expect(assign).toHaveBeenCalledWith(
        "/settings/model-providers#role-default",
      );
    } finally {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
  });

  /** @scenario Disabled scope above project is not user-clearable from the toast */
  it("names the team-scope default but offers no inline swap without a handler", async () => {
    mountToaster();
    // The interceptor only injects onSwapToAlternate for project-scope
    // resolutions — clearing team/org defaults needs permissions the
    // current user may not hold, so the toast gets no swap handler even
    // though an enabled alternate exists.
    showProviderDisabledToast(
      buildProviderDisabledInfo({
        resolvedScope: "team",
        onSwapToAlternate: undefined,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Model unavailable for AI search/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/openai\/gpt-4o is set at team scope/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Open settings")).toBeInTheDocument();
    expect(
      screen.queryByText(/Use organization default/i),
    ).not.toBeInTheDocument();
  });

  /** @scenario Repeated failures within the same scope coalesce into one toast */
  it("renders exactly one toast for the same error signature across a retry storm", async () => {
    mountToaster();
    const info = buildProviderDisabledInfo();
    for (let i = 0; i < 5; i++) {
      showProviderDisabledToast(info);
    }

    await waitFor(() => {
      expect(
        screen.getAllByText(/Model unavailable for AI search/i),
      ).toHaveLength(1);
    });
    expect(toaster.isVisible(providerDisabledToastId(info))).toBe(true);
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
