// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useLangyStore } from "../stores/langyStore";

/**
 * A refresh must put the user back where they were: the panel open or closed as
 * they left it, in the layout they chose, on the conversation they had open.
 *
 * The conversation is the subtle one. It persists as a PAIR — the id and the
 * SCOPE it belongs to (user, organization, project) — because the store is a
 * module singleton that survives the per-project panel remount, and because
 * localStorage belongs to the browser rather than to whoever is signed in. An id
 * alone would follow the user somewhere it does not exist, or somewhere it does
 * exist and does not belong to them.
 *
 * Spec: specs/langy/langy-navigation-persistence.feature.
 */
const readPersisted = (): Record<string, unknown> => {
  const raw = window.localStorage.getItem("langy:store");
  if (!raw) return {};
  const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
  return parsed.state ?? {};
};

describe("Langy open-state persistence", () => {
  beforeEach(() => {
    useLangyStore.getState().closePanel();
  });

  describe("given the user opens the panel", () => {
    /** @scenario A full page reload restores the panel exactly as I left it */
    it("persists isOpen=true so a reload restores it open", () => {
      useLangyStore.getState().openPanel();
      expect(readPersisted().isOpen).toBe(true);
    });
  });

  describe("given the user closes the panel", () => {
    it("persists isOpen=false so a reload restores it closed", () => {
      useLangyStore.getState().openPanel();
      useLangyStore.getState().closePanel();
      expect(readPersisted().isOpen).toBe(false);
    });
  });

  describe("given a durable open state", () => {
    it("carries the panel's own state and the open conversation, nothing else", () => {
      useLangyStore.getState().openPanel();
      const persisted = readPersisted();
      // What the user chose...
      expect(persisted).toHaveProperty("isOpen");
      expect(persisted).toHaveProperty("panelMode");
      // ...including where they were, fenced to the scope it belongs to.
      expect(persisted).toHaveProperty("activeConversationId");
      expect(persisted).toHaveProperty("activeConversationScope");
      // ...but never the per-session working state.
      expect(persisted).not.toHaveProperty("messages");
      expect(persisted).not.toHaveProperty("draft");
      expect(persisted).not.toHaveProperty("turnPhase");
    });
  });
});

describe("Langy conversation restoration", () => {
  describe("given a conversation was open in this project", () => {
    describe("when the panel enters that same project", () => {
      it("restores it and arms the history load so the thread hydrates", () => {
        useLangyStore.getState().resetForProject("project-a");
        useLangyStore.getState().selectConversation("conv-1");
        useLangyStore.getState().consumeHistoryLoad();

        // A refresh: same project, store rehydrated from localStorage.
        useLangyStore.getState().resetForProject("project-a");

        const state = useLangyStore.getState();
        expect(state.activeConversationId).toBe("conv-1");
        // The pointer alone would show the right title over an empty thread —
        // the engine hydrates off historyLoadConversationId.
        expect(state.historyLoadConversationId).toBe("conv-1");
      });
    });

    describe("when the panel enters a DIFFERENT project", () => {
      /** @scenario A conversation is only restored into the project it belongs to */
      it("starts clean, because the id belongs to the other project", () => {
        useLangyStore.getState().resetForProject("project-a");
        useLangyStore.getState().selectConversation("conv-1");

        useLangyStore.getState().resetForProject("project-b");

        const state = useLangyStore.getState();
        expect(state.activeConversationId).toBeNull();
        expect(state.historyLoadConversationId).toBeNull();
      });
    });
  });

  describe("given the user started a new chat before refreshing", () => {
    /** @scenario Starting a new chat is what I come back to */
    it("comes back to a fresh conversation, not the one before it", () => {
      useLangyStore.getState().resetForProject("project-a");
      useLangyStore.getState().selectConversation("conv-1");
      useLangyStore.getState().startNewConversation();

      useLangyStore.getState().resetForProject("project-a");

      expect(useLangyStore.getState().activeConversationId).toBeNull();
    });
  });

  describe("given the SAME project is entered by somebody else", () => {
    /** @scenario Nothing follows me into another account */
    it("starts clean, because a project id is not an identity", () => {
      // The one the project id cannot see, and the reason the fence is a scope
      // rather than a project: a shared machine, a second account, an
      // impersonation session. Same project, different person — and localStorage
      // belongs to the browser, not to whoever is signed in.
      const scope = { organizationId: "org-1", projectId: "project-a" };
      useLangyStore.getState().resetForScope({ ...scope, userId: "user-1" });
      useLangyStore.getState().selectConversation("conv-1");

      useLangyStore.getState().resetForScope({ ...scope, userId: "user-2" });

      expect(useLangyStore.getState().activeConversationId).toBeNull();
    });
  });

  describe("given the project is entered from another organization", () => {
    /** @scenario Nothing follows me into another organization */
    it("starts clean", () => {
      const scope = { userId: "user-1", projectId: "project-a" };
      useLangyStore
        .getState()
        .resetForScope({ ...scope, organizationId: "org-1" });
      useLangyStore.getState().selectConversation("conv-1");

      useLangyStore
        .getState()
        .resetForScope({ ...scope, organizationId: "org-2" });

      expect(useLangyStore.getState().activeConversationId).toBeNull();
    });
  });

  describe("given a caller that only knows the project", () => {
    it("leaves the rest of the scope alone rather than reading as a change", () => {
      // The panel knows the project; the layout knows all three. If the partial
      // caller looked like a scope CHANGE it would wipe the conversation a
      // refresh is meant to be restoring.
      useLangyStore.getState().resetForScope({
        userId: "user-1",
        organizationId: "org-1",
        projectId: "project-a",
      });
      useLangyStore.getState().selectConversation("conv-1");
      useLangyStore.getState().consumeHistoryLoad();

      useLangyStore.getState().resetForProject("project-a");

      expect(useLangyStore.getState().activeConversationId).toBe("conv-1");
      expect(useLangyStore.getState().activeConversationScope).toEqual({
        userId: "user-1",
        organizationId: "org-1",
        projectId: "project-a",
      });
    });
  });
});
