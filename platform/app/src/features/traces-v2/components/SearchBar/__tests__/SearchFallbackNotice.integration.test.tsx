/**
 * @vitest-environment jsdom
 *
 * The strip under the search bar after a search ran without the model that
 * shapes it: one line saying what the sentence was read as and why the words
 * were used as typed, beside a button that can be dismissed.
 *
 * Spec: specs/traces-v2/search.feature ("A search that ran without a model
 * says so").
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

import { useExplorerStore } from "../../../stores/explorerStore";
import { SearchFallbackNotice } from "../SearchFallbackNotice";

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

beforeEach(() => {
  window.localStorage.clear();
  useExplorerStore.getState().clearAll();
});

/** Puts a query in the bar and a notice about that same query beside it. */
function noticeFor(
  notice: Partial<
    NonNullable<ReturnType<typeof useExplorerStore.getState>["searchNotice"]>
  > = {},
) {
  useExplorerStore.getState().applyQueryText('eval:"frustrated users"');
  useExplorerStore.getState().recordSearchNotice({
    projectId: "project-1",
    query: useExplorerStore.getState().queryText,
    interpretedAs: "instant_eval",
    modelTrouble: "model_failed",
    modelErrorCode: "ai_query_provider_error",
    ...notice,
  });
}

describe("given a judgement ran on the sentence as typed", () => {
  describe("when the strip renders", () => {
    /** @scenario "A judge question no model could write is judged as typed" */
    /** @scenario "A search that ran without a model says so" */
    it("names the reading, the code it failed with, and offers the model settings", () => {
      noticeFor();
      render(<SearchFallbackNotice />, { wrapper });

      expect(screen.getByRole("status")).toHaveTextContent(
        "Interpreted as an Instant Eval. The search model failed (ai_query_provider_error), so your words are judged as typed.",
      );
      expect(
        screen.getByRole("link", { name: "Configure models" }),
      ).toHaveAttribute("href", "/settings/model-providers");
    });

    it("says no model is connected when that is the problem", () => {
      noticeFor({ modelTrouble: "no_model", modelErrorCode: undefined });
      render(<SearchFallbackNotice />, { wrapper });
      expect(screen.getByRole("status")).toHaveTextContent(
        "Interpreted as an Instant Eval. No model is connected for search, so your words are judged as typed.",
      );
    });

    it("says only that the model failed when the failure carried no code", () => {
      noticeFor({ modelErrorCode: undefined });
      render(<SearchFallbackNotice />, { wrapper });
      expect(screen.getByRole("status")).toHaveTextContent(
        "The search model failed, so your words are judged as typed.",
      );
    });
  });

  describe("when the button is dismissed", () => {
    /** @scenario "The way to fix it can be dismissed" */
    it("keeps what the search was read as, and stays dismissed on the next search", () => {
      noticeFor();
      const first = render(<SearchFallbackNotice />, { wrapper });

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.getByRole("status")).toHaveTextContent("Interpreted as");
      expect(
        screen.queryByRole("link", { name: "Configure models" }),
      ).toBeNull();

      first.unmount();
      noticeFor();
      render(<SearchFallbackNotice />, { wrapper });
      expect(
        screen.queryByRole("link", { name: "Configure models" }),
      ).toBeNull();
    });
  });
});

describe("given the query moved on from the notice", () => {
  describe("when the strip renders", () => {
    it("shows nothing", () => {
      noticeFor();
      useExplorerStore.getState().applyQueryText("status:error");
      render(<SearchFallbackNotice />, { wrapper });
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});

describe("given a phrase search that another route fell back to", () => {
  describe("when the strip renders", () => {
    /** @scenario "Without a classifier or a model the words are searched as a phrase" */
    it("names the phrase reading", () => {
      useExplorerStore.getState().applyQueryText('"frustrated users"');
      useExplorerStore.getState().recordSearchNotice({
        projectId: "project-1",
        query: useExplorerStore.getState().queryText,
        interpretedAs: "free_text",
        modelTrouble: "no_model",
      });
      render(<SearchFallbackNotice />, { wrapper });
      expect(screen.getByRole("status")).toHaveTextContent(
        "Interpreted as a phrase. No model is connected for search, so your words are matched as typed.",
      );
    });
  });
});
