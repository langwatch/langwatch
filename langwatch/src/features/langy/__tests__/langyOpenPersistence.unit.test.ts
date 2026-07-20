// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useLangyStore } from "../stores/langyStore";

/**
 * The panel's open/closed state is durable: a page reload restores it exactly
 * as the user left it (open stays open, closed stays closed). This guards the
 * `isOpen` entry in the store's persist `partialize` — without it a refresh
 * dropped the panel closed even when the user had it open.
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
    /** @scenario The open state survives a full page reload */
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
    it("carries only the whitelisted keys, not conversation state", () => {
      useLangyStore.getState().openPanel();
      const persisted = readPersisted();
      // The panel's own state is durable...
      expect(persisted).toHaveProperty("isOpen");
      expect(persisted).toHaveProperty("panelMode");
      // ...but the per-session conversation is not (it must start clean).
      expect(persisted).not.toHaveProperty("messages");
      expect(persisted).not.toHaveProperty("activeConversationId");
    });
  });
});
