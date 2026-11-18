/**
 * @vitest-environment jsdom
 *
 * A link from another tool opens Langy with its question typed, never sent, once.
 * @see specs/langy/langy-prompt-link.feature
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLangyStore } from "../langy.store.ts";
import { useLangyPromptLink } from "../use-langy-prompt-link.ts";

const project = { current: { id: "project_1" } as { id: string } | undefined };

vi.mock("../use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: project.current }),
}));

const SCOPE = { userId: "user_1", organizationId: "org_1", projectId: "project_1" };
const EXPLORER_HASH = "#all-traces?q=trace.attribute.laze.agent.id:agent_1";

function renderAt(entry: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => {
      useLangyPromptLink();
      return useLocation();
    },
    { wrapper },
  );
}

beforeEach(() => {
  project.current = { id: "project_1" };
  useLangyStore.setState({
    isOpen: false,
    savedOpenBeforeLink: null,
    draft: "",
    pendingPrompt: null,
    activeConversationId: null,
    activeConversationScope: null,
    scopeAnnounced: false,
  });
});

describe("useLangyPromptLink", () => {
  describe("given Langy is closed and the project is known", () => {
    /** @scenario "The link opens Langy with the question in the composer" */
    it("opens the panel on a new conversation with the question typed and nothing sent", async () => {
      useLangyStore.getState().resetForScope(SCOPE);
      useLangyStore.setState({ activeConversationId: "langyconv_old" });

      renderAt(
        "/my-project/traces?langy=open&langyPrompt=Which%20traces%20spent%20the%20most%20tokens%3F",
      );

      await waitFor(() => expect(useLangyStore.getState().isOpen).toBe(true));
      const state = useLangyStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.draft).toBe("Which traces spent the most tokens?");
      expect(state.pendingPrompt).toBeNull();
    });

    /** @scenario "The parameters are removed after they are applied" */
    it("drops its parameters and keeps the Explorer's query in the hash", async () => {
      useLangyStore.getState().resetForScope(SCOPE);

      const { result } = renderAt(
        `/my-project/traces?langy=open&langyPrompt=hello&tab=1${EXPLORER_HASH}`,
      );

      await waitFor(() => expect(result.current.search).toBe("?tab=1"));
      expect(result.current.pathname).toBe("/my-project/traces");
      expect(result.current.hash).toBe(EXPLORER_HASH);
      expect(useLangyStore.getState().draft).toBe("hello");
    });
  });

  describe("given only the question in the link", () => {
    /** @scenario "A link with only the question still opens Langy" */
    it("opens the panel with the question typed", async () => {
      useLangyStore.getState().resetForScope(SCOPE);

      renderAt("/my-project/traces?langyPrompt=hello");

      await waitFor(() => expect(useLangyStore.getState().isOpen).toBe(true));
      expect(useLangyStore.getState().draft).toBe("hello");
    });
  });

  describe("given a conversation link beside the question", () => {
    /** @scenario "A question link beside a conversation link opens a new conversation" */
    it("opens a new conversation with the question and drops the conversation link", async () => {
      useLangyStore.getState().resetForScope(SCOPE);
      useLangyStore.setState({ activeConversationId: "langyconv_1" });

      const { result } = renderAt(
        "/my-project/traces?langyConversation=langyconv_1&langyPrompt=hello",
      );

      await waitFor(() => expect(result.current.search).toBe(""));
      expect(useLangyStore.getState().activeConversationId).toBeNull();
      expect(useLangyStore.getState().draft).toBe("hello");
    });
  });

  describe("given the project has not loaded yet", () => {
    /** @scenario "The question waits until the project is known" */
    it("types nothing until the scope is announced, then types the question", async () => {
      project.current = undefined;
      const { result, rerender } = renderAt("/my-project/traces?langyPrompt=hello");

      expect(useLangyStore.getState().draft).toBe("");
      expect(result.current.search).toBe("?langyPrompt=hello");

      project.current = { id: "project_1" };
      rerender();
      expect(useLangyStore.getState().draft).toBe("");
      expect(result.current.search).toBe("?langyPrompt=hello");

      act(() => useLangyStore.getState().resetForScope(SCOPE));
      rerender();

      await waitFor(() => expect(useLangyStore.getState().draft).toBe("hello"));
      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(result.current.search).toBe("");
    });
  });
});
