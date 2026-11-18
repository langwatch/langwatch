// @vitest-environment jsdom
import { readerUiStorage, setUiStorageReader } from "@langwatch/browser-host/storage";
import { LANGY_STORE_SLICE } from "@langwatch/langy-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { useLangyStore } from "../langy.store.ts";

/** Spec: specs/langy/langy-prompt-link.feature */

const langy = () => useLangyStore.getState();

function savedIsOpen(): unknown {
  const raw = readerUiStorage.getItem(LANGY_STORE_SLICE);
  return raw ? (JSON.parse(raw) as { state: { isOpen?: unknown } }).state.isOpen : undefined;
}

describe("openFromLink", () => {
  beforeEach(() => {
    setUiStorageReader("user-1");
    langy().closePanel();
    langy().setDraft("");
  });

  describe("given I had Langy closed", () => {
    /** @scenario "Opening by link does not change my saved panel preference" */
    it("opens the panel but keeps the saved preference closed until I choose", () => {
      langy().openFromLink("Which traces spent the most tokens?");

      expect(langy().isOpen).toBe(true);
      expect(savedIsOpen()).toBe(false);

      langy().closePanel();
      expect(savedIsOpen()).toBe(false);
      langy().openPanel();
      expect(savedIsOpen()).toBe(true);
    });
  });

  describe("given a link opened Langy and I then ask Langy something", () => {
    it("saves the panel as open, since asking was my own choice", () => {
      langy().openFromLink("hello");
      expect(savedIsOpen()).toBe(false);

      langy().askLangy("what failed?");

      expect(langy().savedOpenBeforeLink).toBeNull();
      expect(savedIsOpen()).toBe(true);
    });
  });

  describe("given another reader signs in after a link opened Langy", () => {
    it("saves the new reader's own open state, not the link's kept one", () => {
      langy().openFromLink("hello");
      setUiStorageReader("user-2");

      expect(langy().savedOpenBeforeLink).toBeNull();
      langy().setDraft("x");
      expect(savedIsOpen()).toBe(langy().isOpen);
    });
  });

  describe("given a question in the link", () => {
    it("starts a fresh conversation with the question typed", () => {
      useLangyStore.setState({ activeConversationId: "langyconv_old" });

      langy().openFromLink("  Which traces spent the most tokens?  ");

      expect(langy().activeConversationId).toBeNull();
      expect(langy().draft).toBe("Which traces spent the most tokens?");
      expect(langy().pendingPrompt).toBeNull();
    });
  });

  describe("given an empty question", () => {
    /** @scenario "A link with an empty question opens Langy without typing anything" */
    it("opens the panel and keeps the composer as it was", () => {
      useLangyStore.setState({ activeConversationId: "langyconv_old" });
      langy().setDraft("half typed");

      langy().openFromLink("   ");

      expect(langy().isOpen).toBe(true);
      expect(langy().draft).toBe("half typed");
      expect(langy().activeConversationId).toBe("langyconv_old");
    });
  });
});
