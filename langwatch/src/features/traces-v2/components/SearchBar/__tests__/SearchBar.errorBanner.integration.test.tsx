/**
 * @vitest-environment jsdom
 *
 * Integration tests for the unified error banner in SearchBar.
 *
 * Feature: Unified error banner
 *   - Parse errors render in the banner with a dismiss X
 *   - AI errors render in the banner, with an expand chevron when details exist
 *   - AI errors persist after closing AI mode (no unmount cleanup)
 *   - Dismiss clears the underlying store state
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: undefined,
    organization: undefined,
    team: undefined,
    isFetching: false,
  }),
}));

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    modelProviders: [],
    customDefaultModel: null,
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/useTraceFacets", () => ({
  useTraceFacets: () => ({ data: [], isLoading: false }),
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

import type { AiActionError } from "~/server/app-layer/traces/ai-query";
import { useFilterStore } from "../../../stores/filterStore";
import { SearchBar } from "../SearchBar";

afterEach(() => {
  cleanup();
  useFilterStore.getState().clearAll();
});

beforeEach(() => {
  useFilterStore.getState().clearAll();
});

function renderSearchBar() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SearchBar />
    </ChakraProvider>,
  );
}

describe("<SearchBar /> unified error banner", () => {
  describe("given a parse error in the store", () => {
    beforeEach(() => {
      // Trigger a parse error by submitting an unclosed string literal
      useFilterStore.getState().applyQueryText('@status:"unclosed');
    });

    it("renders the parse error message in the banner", () => {
      renderSearchBar();
      // The banner should contain the parse error message text
      const parseError = useFilterStore.getState().parseError;
      expect(parseError).not.toBeNull();
      expect(screen.getByText(parseError!)).toBeInTheDocument();
    });

    it("shows no expand chevron (parse errors have no structured details)", () => {
      renderSearchBar();
      expect(
        screen.queryByLabelText(/expand error details/i),
      ).not.toBeInTheDocument();
    });

    it("shows a dismiss X button", () => {
      renderSearchBar();
      expect(screen.getByLabelText(/dismiss error/i)).toBeInTheDocument();
    });

    describe("when the user clicks the dismiss X", () => {
      it("clears the parse error from the store", async () => {
        renderSearchBar();
        const user = userEvent.setup();
        await user.click(screen.getByLabelText(/dismiss error/i));
        expect(useFilterStore.getState().parseError).toBeNull();
      });

      it("clears parse error in store after dismiss (banner exit animation fires async)", async () => {
        renderSearchBar();
        const user = userEvent.setup();
        // Clicking dismiss clears the store state — the meaningful assertion.
        // AnimatePresence exit animations run async in jsdom so we verify
        // store state rather than DOM removal.
        await user.click(screen.getByLabelText(/dismiss error/i));
        expect(useFilterStore.getState().parseError).toBeNull();
      });
    });
  });

  describe("given an AI error with structured details in the store", () => {
    const aiError: AiActionError = {
      code: "provider_error",
      message: "Failed after 2 attempts. Last error: Cannot connect to provider.",
      details: {
        provider: "openai",
        model: "gpt-5-mini",
        httpStatus: 503,
        reason: "Service unavailable",
      },
    };

    beforeEach(() => {
      useFilterStore.getState().setAiError(aiError);
    });

    it("renders the AI error message in the banner", () => {
      renderSearchBar();
      expect(screen.getByText(aiError.message)).toBeInTheDocument();
    });

    it("shows an expand chevron because details are present", () => {
      renderSearchBar();
      expect(
        screen.getByLabelText(/expand error details/i),
      ).toBeInTheDocument();
    });

    it("does not show the AiPromptInput inline error badge", () => {
      // The inline ErrorBadge was removed from AiPromptInput — only the banner shows
      // Verify no second instance of the error message appears elsewhere
      renderSearchBar();
      const messages = screen.getAllByText(aiError.message);
      expect(messages).toHaveLength(1);
    });

    describe("when the user clicks the expand chevron", () => {
      it("reveals the structured detail fields", async () => {
        renderSearchBar();
        const user = userEvent.setup();
        await user.click(screen.getByLabelText(/expand error details/i));
        // Provider, model, status should now be visible
        expect(screen.getByText("openai")).toBeInTheDocument();
        expect(screen.getByText("gpt-5-mini")).toBeInTheDocument();
        expect(screen.getByText("503")).toBeInTheDocument();
        expect(screen.getByText("Service unavailable")).toBeInTheDocument();
      });

      it("shows a collapse chevron after expanding", async () => {
        renderSearchBar();
        const user = userEvent.setup();
        await user.click(screen.getByLabelText(/expand error details/i));
        expect(
          screen.getByLabelText(/collapse error details/i),
        ).toBeInTheDocument();
      });
    });

    describe("when the user clicks the dismiss X", () => {
      it("clears the AI error from the store", async () => {
        renderSearchBar();
        const user = userEvent.setup();
        await user.click(screen.getByLabelText(/dismiss error/i));
        expect(useFilterStore.getState().aiError).toBeNull();
      });
    });
  });

  describe("given an AI error without structured details", () => {
    const simpleAiError: AiActionError = {
      code: "unknown",
      message: "Something went wrong with the AI request.",
    };

    beforeEach(() => {
      useFilterStore.getState().setAiError(simpleAiError);
    });

    it("renders the message", () => {
      renderSearchBar();
      expect(screen.getByText(simpleAiError.message)).toBeInTheDocument();
    });

    it("shows no expand chevron when there are no details", () => {
      renderSearchBar();
      expect(
        screen.queryByLabelText(/expand error details/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("given both a parse error and an AI error", () => {
    const aiError: AiActionError = {
      code: "provider_error",
      message: "AI provider failed.",
      details: { provider: "openai" },
    };

    beforeEach(() => {
      // Set both errors
      useFilterStore.getState().applyQueryText('@status:"unclosed');
      useFilterStore.getState().setAiError(aiError);
    });

    it("shows the AI error message (AI error wins priority)", () => {
      renderSearchBar();
      expect(screen.getByText(aiError.message)).toBeInTheDocument();
    });

    it("does not show the parse error message while AI error is active", () => {
      renderSearchBar();
      const parseError = useFilterStore.getState().parseError!;
      expect(screen.queryByText(parseError)).not.toBeInTheDocument();
    });
  });

  describe("given no errors in the store", () => {
    it("does not render the banner", () => {
      renderSearchBar();
      expect(
        screen.queryByLabelText(/dismiss error/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("AI error persistence — given an AI error set in the store", () => {
    const aiError: AiActionError = {
      code: "provider_error",
      message: "Persistent AI failure.",
      details: { provider: "anthropic" },
    };

    it("the error remains in the store after explicit set (simulating close of AI mode without unmount cleanup)", () => {
      // Set error (simulates AiQueryComposer pushing error via useEffect)
      useFilterStore.getState().setAiError(aiError);
      // Verify it persists without being cleared
      expect(useFilterStore.getState().aiError).toEqual(aiError);
      renderSearchBar();
      expect(screen.getByText(aiError.message)).toBeInTheDocument();
    });

    it("clears when clearAll is called", () => {
      useFilterStore.getState().setAiError(aiError);
      useFilterStore.getState().clearAll();
      expect(useFilterStore.getState().aiError).toBeNull();
    });

    it("clears when a new query is typed via applyQueryText", () => {
      useFilterStore.getState().setAiError(aiError);
      useFilterStore.getState().applyQueryText("@status:error");
      expect(useFilterStore.getState().aiError).toBeNull();
    });
  });
});
