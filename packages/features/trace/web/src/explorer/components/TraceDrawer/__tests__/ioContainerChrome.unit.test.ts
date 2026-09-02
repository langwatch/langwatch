import { describe, expect, it } from "vitest";
import { ioContainerChrome } from "../IOViewer";

// The IOViewer's outer container chrome decides whether the body sits in a
// bordered "bg.subtle + border" box (like Pretty's plain-text / JSON view)
// or paints flush. Round 5: rendered Markdown must share the bordered box
// with Pretty so the two read consistently side by side.
describe("ioContainerChrome", () => {
  describe("given the rendered Markdown view", () => {
    const chrome = ioContainerChrome({
      format: "markdown",
      isChat: false,
      markdownSubmode: "rendered",
      isVirtualizingChat: false,
    });

    it("keeps the bordered container (not flush)", () => {
      expect(chrome.flush).toBe(false);
    });

    it("matches Pretty's plain-text Markdown padding", () => {
      const pretty = ioContainerChrome({
        format: "pretty",
        isChat: false,
        markdownSubmode: "rendered",
        isVirtualizingChat: false,
      });
      expect(chrome.innerPadding).toBe(pretty.innerPadding);
      expect(chrome.innerPadding).toBeGreaterThan(0);
    });
  });

  describe("given the Markdown source view", () => {
    const chrome = ioContainerChrome({
      format: "markdown",
      isChat: false,
      markdownSubmode: "source",
      isVirtualizingChat: false,
    });

    it("keeps the bordered container", () => {
      expect(chrome.flush).toBe(false);
    });

    it("drops the inner padding so the flush Shiki block hugs the border", () => {
      expect(chrome.innerPadding).toBe(0);
    });
  });

  describe("given Pretty mode over a chat transcript", () => {
    it("paints flush so the per-turn chrome isn't double-boxed", () => {
      const chrome = ioContainerChrome({
        format: "pretty",
        isChat: true,
        markdownSubmode: "rendered",
        isVirtualizingChat: false,
      });
      expect(chrome.flush).toBe(true);
      expect(chrome.innerPadding).toBe(0);
    });
  });

  describe("given the virtualized chat list", () => {
    it("drops the inner padding so it owns its own scroll viewport", () => {
      const chrome = ioContainerChrome({
        format: "pretty",
        isChat: true,
        markdownSubmode: "rendered",
        isVirtualizingChat: true,
      });
      expect(chrome.innerPadding).toBe(0);
    });
  });

  describe("given Pretty mode over plain text", () => {
    it("keeps the bordered, padded container", () => {
      const chrome = ioContainerChrome({
        format: "pretty",
        isChat: false,
        markdownSubmode: "rendered",
        isVirtualizingChat: false,
      });
      expect(chrome.flush).toBe(false);
      expect(chrome.innerPadding).toBeGreaterThan(0);
    });
  });

  describe("given the JSON view", () => {
    it("keeps the bordered, padded container", () => {
      const chrome = ioContainerChrome({
        format: "json",
        isChat: false,
        markdownSubmode: "rendered",
        isVirtualizingChat: false,
      });
      expect(chrome.flush).toBe(false);
      expect(chrome.innerPadding).toBeGreaterThan(0);
    });
  });
});
