/**
 * The one capability Langy publishes: what a guided onboarding may do to the
 * panel, proven against the store it writes.
 */
import { useLangyStore } from "@langwatch/langy-browser-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { langyGuidedOnboarding } from "../langy-guided-onboarding.capability.ts";

const scope = { userId: "user_1", organizationId: "org_1", projectId: "proj_1" };

beforeEach(() => {
  useLangyStore.setState({
    isOpen: false,
    pendingKickoff: null,
    activeConversationId: null,
    activeConversationScope: null,
    scopeAnnounced: false,
  });
});

describe("given a guided onboarding handing over to Langy", () => {
  describe("when it docks the panel", () => {
    it("opens it in the sidebar", () => {
      langyGuidedOnboarding.dock();

      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(useLangyStore.getState().panelMode).toBe("sidebar");
    });
  });

  describe("when it queues a kickoff for a conversation it already attached", () => {
    it("opens the panel on that conversation with the brief waiting", () => {
      langyGuidedOnboarding.queueKickoff({ brief: "set up tracing", conversationId: "conv_1" });

      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.activeConversationId).toBe("conv_1");
      expect(state.historyLoadConversationId).toBe("conv_1");
      expect(state.pendingKickoff).toEqual({ brief: "set up tracing", conversationId: "conv_1" });
    });
  });

  describe("when it queues a kickoff with no conversation", () => {
    it("starts fresh, so the transport's new conversation takes it", () => {
      langyGuidedOnboarding.queueKickoff({ brief: "set up tracing" });

      const state = useLangyStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.pendingKickoff?.brief).toBe("set up tracing");
    });
  });

  describe("when the panel takes the kickoff", () => {
    it("clears it, so it sends once", () => {
      langyGuidedOnboarding.queueKickoff({ brief: "set up tracing" });

      useLangyStore.getState().consumePendingKickoff();

      expect(useLangyStore.getState().pendingKickoff).toBeNull();
    });
  });
});

describe("given a caller waiting for the panel's scope", () => {
  describe("when the scope has not been announced yet", () => {
    it("calls back on the announcement, with the scope announced", () => {
      const announced = vi.fn();

      const release = langyGuidedOnboarding.onScopeAnnounced(announced);
      expect(announced).not.toHaveBeenCalled();

      useLangyStore.getState().resetForScope(scope);

      expect(announced).toHaveBeenCalledWith(expect.objectContaining(scope));
      release();
    });

    it("calls back once, not on every later write", () => {
      const announced = vi.fn();

      langyGuidedOnboarding.onScopeAnnounced(announced);
      useLangyStore.getState().resetForScope(scope);
      useLangyStore.getState().resetForProject("proj_2");

      expect(announced).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the scope was announced before the caller arrived", () => {
    it("calls back at once, so a late caller is not left waiting", () => {
      const announced = vi.fn();
      useLangyStore.getState().resetForScope(scope);

      langyGuidedOnboarding.onScopeAnnounced(announced);

      expect(announced).toHaveBeenCalledWith(expect.objectContaining(scope));
    });
  });

  describe("when a kickoff is owed and the persisted scope already names this page", () => {
    /** @scenario a kickoff owed right away waits for Langy to announce the page's scope */
    it("waits for this page load's announcement, then keeps the kickoff through a repeat", () => {
      useLangyStore.setState({ activeConversationScope: scope, scopeAnnounced: false });
      langyGuidedOnboarding.dock();

      langyGuidedOnboarding.onScopeAnnounced(() =>
        langyGuidedOnboarding.queueKickoff({ brief: "set up the gateway" }),
      );
      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(useLangyStore.getState().pendingKickoff).toBeNull();

      useLangyStore.getState().resetForScope(scope);
      expect(useLangyStore.getState().pendingKickoff?.brief).toBe("set up the gateway");

      useLangyStore.getState().resetForProject(scope.projectId);
      expect(useLangyStore.getState().pendingKickoff?.brief).toBe("set up the gateway");
    });
  });

  describe("when the caller releases before any announcement", () => {
    it("hears nothing afterwards", () => {
      const announced = vi.fn();

      const release = langyGuidedOnboarding.onScopeAnnounced(announced);
      release();
      useLangyStore.getState().resetForScope(scope);

      expect(announced).not.toHaveBeenCalled();
    });
  });
});
