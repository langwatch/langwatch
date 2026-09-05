/**
 * @vitest-environment jsdom
 * UX contract: specs/model-providers/missing-model-popup.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  aiCallFailedToastId,
  missingModelToastId,
  type ProviderDisabledInfo,
  providerDisabledToastId,
  showAiCallFailedToast,
  showMissingModelToast,
  showProviderDisabledToast,
} from "../missing-model-toast";

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
  describe("given the toast opens for a feature missing its Fast role model", () => {
    /** @scenario The toast names the feature, the role, and the scope it couldn't resolve from */
    it("renders the feature name + role in the toast body", async () => {
      mountToaster();
      showMissingModelToast({
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectSlug: "acme-app",
        canConfigure: true,
        navigate: vi.fn(),
      });

      await waitFor(() => {
        expect(screen.getByText(/Model not configured for AI search/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/Pick a Fast model in Model Providers/i)).toBeInTheDocument();
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
        navigate: vi.fn(),
      });

      const title = await screen.findByText(/Model not configured for AI search/i);
      const root = title.closest("[data-type]");
      expect(root).not.toBeNull();
      expect(root!.getAttribute("data-type")).toBe("info");
    });
  });

  describe("when the caller can configure the missing role", () => {
    /** @scenario The modal carries one primary CTA to the right settings page and role */
    it("renders a Configure action that navigates to the role anchor", async () => {
      mountToaster();
      const navigate = vi.fn();
      showMissingModelToast({
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectSlug: "acme-app",
        canConfigure: true,
        navigate,
      });

      const action = await screen.findByText(/Configure Fast model/i);
      fireEvent.click(action);
      expect(navigate).toHaveBeenCalledWith("/settings/model-providers#role-fast");
    });
  });

  describe("when the caller is a read-only user", () => {
    /** @scenario A read-only user sees the modal but no Configure button */
    it("omits the Configure action when the caller can't configure", async () => {
      mountToaster();
      showMissingModelToast({
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectSlug: "acme-app",
        canConfigure: false,
        navigate: vi.fn(),
      });

      await waitFor(() => {
        expect(screen.getByText(/Model not configured for AI search/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Configure Fast model/i)).not.toBeInTheDocument();
      expect(
        screen.getByText(/Ask an organization or project admin to set a Fast model/i),
      ).toBeInTheDocument();
    });
  });

  describe("when identical errors arrive in a retry storm", () => {
    /** @scenario Identical errors in quick succession only open one modal */
    it("dedupes by stable id when the same toast is already visible", async () => {
      mountToaster();
      const info = {
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST" as const,
        projectSlug: "acme-app",
        canConfigure: true,
        navigate: vi.fn(),
      };
      showMissingModelToast(info);
      showMissingModelToast(info);
      showMissingModelToast(info);

      await waitFor(() => {
        expect(screen.getAllByText(/Model not configured for AI search/i)).toHaveLength(1);
      });
      expect(toaster.isVisible(missingModelToastId(info))).toBe(true);
    });
  });
});

describe("showAiCallFailedToast", () => {
  describe("when a downstream AI call fails for a configured model", () => {
    /** @scenario Downstream AI failures surface a hint to verify model configuration */
    it("surfaces the feature label and the hint, never the provider's own words", async () => {
      mountToaster();
      showAiCallFailedToast({
        featureKey: "workflows.commit_message",
        featureDisplayName: "Workflow commit message",
        role: "FAST",
        projectSlug: "acme-app",
        navigate: vi.fn(),
      });

      await waitFor(() => {
        expect(screen.getByText(/Workflow commit message failed/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/Double-check your Fast model configuration/i)).toBeInTheDocument();
      // No channel carries the provider's raw sentence to this toast.
      expect(screen.queryByText(/401 Unauthorized/i)).not.toBeInTheDocument();
    });

    /** @scenario A failed assistive AI call warns, it does not error */
    it("renders as a warning toast, not an error", async () => {
      mountToaster();
      showAiCallFailedToast({
        featureKey: "workflows.commit_message",
        featureDisplayName: "Workflow commit message",
        role: "FAST",
        projectSlug: "acme-app",
        navigate: vi.fn(),
      });

      const title = await screen.findByText(/Workflow commit message failed/i);
      const root = title.closest("[data-type]");
      expect(root).not.toBeNull();
      expect(root!.getAttribute("data-type")).toBe("warning");
    });
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
    navigate: vi.fn(),
    ...overrides,
  };
}

describe("showProviderDisabledToast", () => {
  describe("given a project-scope default whose provider is disabled", () => {
    /** @scenario Project-scope override with disabled provider and an org alternate */
    it("names the disabled project default and swaps to the org alternate on click", async () => {
      mountToaster();
      const onSwapToAlternate = vi.fn();
      showProviderDisabledToast(buildProviderDisabledInfo({ onSwapToAlternate }));

      await waitFor(() => {
        expect(screen.getByText(/Model unavailable for AI search/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/openai\/gpt-4o is set at project scope/i)).toBeInTheDocument();
      const swapButton = screen.getByText("Use organization default (azure/gpt-4o)");
      fireEvent.click(swapButton);
      // The click delegates to the injected swap handler — the interceptor
      // wires this to the feature-override mutation at project scope.
      expect(onSwapToAlternate).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the cascade has no alternate", () => {
    /** @scenario No alternate falls back to settings deep-link */
    it("navigates to settings when the cascade has no alternate", async () => {
      mountToaster();
      const navigate = vi.fn();
      showProviderDisabledToast(
        buildProviderDisabledInfo({
          alternate: null,
          onSwapToAlternate: undefined,
          navigate,
        }),
      );

      const settingsButton = await screen.findByText("Open settings");
      fireEvent.click(settingsButton);
      expect(navigate).toHaveBeenCalledWith("/settings/model-providers#role-default");
    });
  });

  describe("given the disabled default sits above project scope", () => {
    /** @scenario Disabled scope above project is not user-clearable from the toast */
    it("names the team-scope default but offers no inline swap without a handler", async () => {
      mountToaster();
      // The interceptor only injects onSwapToAlternate for project-scope
      // resolutions — clearing team/org defaults needs permissions the
      // current user may not hold.
      showProviderDisabledToast(
        buildProviderDisabledInfo({
          resolvedScope: "team",
          onSwapToAlternate: undefined,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText(/Model unavailable for AI search/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/openai\/gpt-4o is set at team scope/i)).toBeInTheDocument();
      expect(screen.getByText("Open settings")).toBeInTheDocument();
      expect(screen.queryByText(/Use organization default/i)).not.toBeInTheDocument();
    });
  });

  describe("given a retry storm within the same scope", () => {
    /** @scenario Repeated failures within the same scope coalesce into one toast */
    it("renders exactly one toast for the same error signature across a retry storm", async () => {
      mountToaster();
      const info = buildProviderDisabledInfo();
      for (let i = 0; i < 5; i++) {
        showProviderDisabledToast(info);
      }

      await waitFor(() => {
        expect(screen.getAllByText(/Model unavailable for AI search/i)).toHaveLength(1);
      });
      expect(toaster.isVisible(providerDisabledToastId(info))).toBe(true);
    });
  });
});
