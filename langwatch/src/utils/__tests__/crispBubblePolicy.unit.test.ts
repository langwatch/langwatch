/**
 * @vitest-environment jsdom
 *
 * The Crisp bubble policy manipulates the real DOM (html attribute, window
 * and document listeners, MutationObserver), so it needs a browser-like
 * environment. Crisp itself is faked: a recording queue whose "on" pushes
 * register callbacks the same way Crisp's real boot drains them.
 *
 * Spec: specs/support/crisp-bubble-suppression.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertCrispChatHidden,
  installCrispBubblePolicy,
  toggleSupportChat,
} from "../crispBubblePolicy";

const SUPPRESSED_ATTRIBUTE = "data-crisp-suppressed";

type FakeCrisp = {
  push: (args: unknown[]) => void;
  pushes: unknown[][];
  trigger: (event: string) => void;
};

type CrispGlobals = {
  $crisp?: unknown;
  CRISP_READY_TRIGGER?: () => void;
};

const crispGlobals = () => window as unknown as CrispGlobals;

function installFakeCrisp(): FakeCrisp {
  const handlers = new Map<string, () => void>();
  const pushes: unknown[][] = [];
  const fake: FakeCrisp = {
    pushes,
    push: (args) => {
      pushes.push(args);
      const [kind, event, callback] = args as [string, string, () => void];
      if (kind === "on") handlers.set(event, callback);
      if (kind === "off") handlers.delete(event);
    },
    trigger: (event) => handlers.get(event)?.(),
  };
  crispGlobals().$crisp = fake;
  return fake;
}

function hideCount(fake: FakeCrisp): number {
  return fake.pushes.filter(
    (args) => args[0] === "do" && args[1] === "chat:hide",
  ).length;
}

const isSuppressed = () =>
  document.documentElement.hasAttribute(SUPPRESSED_ATTRIBUTE);

let uninstall: (() => void) | undefined;

function installPolicy(): () => void {
  uninstall = installCrispBubblePolicy();
  return uninstall;
}

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  crispGlobals().$crisp = undefined;
  crispGlobals().CRISP_READY_TRIGGER = undefined;
  document.body.innerHTML = "";
});

describe("crispBubblePolicy", () => {
  describe("when the policy installs with crisp present", () => {
    /** @scenario The bubble is suppressed from the first paint */
    it("pushes chat:hide and marks the document suppressed", () => {
      const fake = installFakeCrisp();

      installPolicy();

      expect(hideCount(fake)).toBe(1);
      expect(isSuppressed()).toBe(true);
    });

    it("registers the opened, closed and message bindings with crisp", () => {
      const fake = installFakeCrisp();

      installPolicy();

      const registered = fake.pushes
        .filter((args) => args[0] === "on")
        .map((args) => args[1]);
      expect(registered).toEqual([
        "chat:opened",
        "chat:closed",
        "message:received",
      ]);
    });
  });

  describe("when the tab becomes visible again", () => {
    /** @scenario Switching back to the browser tab re-hides the bubble */
    it("re-pushes chat:hide", () => {
      const fake = installFakeCrisp();
      installPolicy();
      const before = hideCount(fake);

      document.dispatchEvent(new Event("visibilitychange"));

      expect(hideCount(fake)).toBe(before + 1);
    });
  });

  describe("when the page is restored from the back-forward cache", () => {
    /** @scenario Returning to the page or refocusing the window re-hides the bubble */
    it("re-pushes chat:hide on pageshow", () => {
      const fake = installFakeCrisp();
      installPolicy();
      const before = hideCount(fake);

      window.dispatchEvent(new Event("pageshow"));

      expect(hideCount(fake)).toBe(before + 1);
    });
  });

  describe("when the window regains focus", () => {
    /** @scenario Returning to the page or refocusing the window re-hides the bubble */
    it("re-pushes chat:hide on focus", () => {
      const fake = installFakeCrisp();
      installPolicy();
      const before = hideCount(fake);

      window.dispatchEvent(new Event("focus"));

      expect(hideCount(fake)).toBe(before + 1);
    });
  });

  describe("when crisp reports it is ready", () => {
    /** @scenario Crisp finishing its own boot re-hides the bubble */
    it("re-pushes chat:hide from CRISP_READY_TRIGGER", () => {
      const fake = installFakeCrisp();
      installPolicy();
      const before = hideCount(fake);

      crispGlobals().CRISP_READY_TRIGGER?.();

      expect(hideCount(fake)).toBe(before + 1);
    });

    it("chains a ready trigger that was set before install", () => {
      installFakeCrisp();
      const previous = vi.fn();
      crispGlobals().CRISP_READY_TRIGGER = previous;
      installPolicy();

      crispGlobals().CRISP_READY_TRIGGER?.();

      expect(previous).toHaveBeenCalledTimes(1);
    });
  });

  describe("when crisp inserts its container into the DOM", () => {
    /** @scenario Crisp re-inserting its widget into the page re-hides the bubble */
    it("re-pushes chat:hide when the container appears", async () => {
      const fake = installFakeCrisp();
      installPolicy();
      const before = hideCount(fake);

      const container = document.createElement("div");
      container.className = "crisp-client";
      document.body.appendChild(container);

      await vi.waitFor(() => {
        expect(hideCount(fake)).toBe(before + 1);
      });
    });

    it("ignores unrelated nodes appended to the body", async () => {
      const fake = installFakeCrisp();
      installPolicy();
      const before = hideCount(fake);

      const portal = document.createElement("div");
      portal.className = "chakra-portal";
      document.body.appendChild(portal);

      // Flush the observer callback before asserting nothing happened.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(hideCount(fake)).toBe(before);
    });
  });

  describe("when the user opens the support chat from the sidebar", () => {
    /** @scenario Deliberately opening the support chat lifts suppression */
    it("lifts the suppression attribute and pushes show and toggle", () => {
      const fake = installFakeCrisp();
      installPolicy();

      toggleSupportChat();

      expect(isSuppressed()).toBe(false);
      expect(fake.pushes).toContainEqual(["do", "chat:show"]);
      expect(fake.pushes).toContainEqual(["do", "chat:toggle"]);
    });

    describe("when the chat box is closed again", () => {
      /** @scenario Closing the support chat restores suppression */
      it("restores the suppression attribute and re-hides", () => {
        const fake = installFakeCrisp();
        installPolicy();
        toggleSupportChat();
        const before = hideCount(fake);

        fake.trigger("chat:closed");

        expect(isSuppressed()).toBe(true);
        expect(hideCount(fake)).toBe(before + 1);
      });
    });

    describe("when the tab switches while the chat is open", () => {
      /** @scenario Switching tabs while chatting keeps the conversation visible */
      it("pushes no hide and keeps suppression lifted", () => {
        const fake = installFakeCrisp();
        installPolicy();
        toggleSupportChat();
        fake.trigger("chat:opened");
        const before = hideCount(fake);

        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));

        expect(hideCount(fake)).toBe(before);
        expect(isSuppressed()).toBe(false);
      });
    });

    describe("when every defensive trigger fires while the chat is open", () => {
      /** @scenario Every re-hide trigger stands down while the chat is deliberately open */
      it("keeps all suppression layers disabled until the chat closes", async () => {
        const fake = installFakeCrisp();
        installPolicy();
        toggleSupportChat();
        fake.trigger("chat:opened");
        const before = hideCount(fake);

        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("focus"));
        crispGlobals().CRISP_READY_TRIGGER?.();
        const container = document.createElement("div");
        container.id = "crisp-chatbox";
        document.body.appendChild(container);
        // Flush the observer callback before asserting nothing happened.
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(hideCount(fake)).toBe(before);
        expect(isSuppressed()).toBe(false);

        fake.trigger("chat:closed");

        expect(isSuppressed()).toBe(true);
        expect(hideCount(fake)).toBe(before + 1);
      });
    });
  });

  describe("when the chat is opened by a caller pushing chat:toggle directly", () => {
    /** @scenario Opening the chat from any other entry point lifts suppression */
    it("lifts suppression on the chat:opened event", () => {
      const fake = installFakeCrisp();
      installPolicy();
      expect(isSuppressed()).toBe(true);

      fake.trigger("chat:opened");

      expect(isSuppressed()).toBe(false);
    });
  });

  describe("when an operator message arrives while suppressed", () => {
    /** @scenario An operator reply is never hidden */
    it("lifts suppression so the reply is visible", () => {
      const fake = installFakeCrisp();
      installPolicy();

      fake.trigger("message:received");

      expect(isSuppressed()).toBe(false);
    });
  });

  describe("when the policy installs before crisp boots", () => {
    /** @scenario Installs without Crisp loaded still work at boot time */
    it("queues the hide command and event bindings for crisp to drain", () => {
      installPolicy();

      const queue = crispGlobals().$crisp as unknown[][];
      expect(Array.isArray(queue)).toBe(true);
      expect(queue).toContainEqual(["do", "chat:hide"]);
      const registered = queue
        .filter((args) => args[0] === "on")
        .map((args) => args[1]);
      expect(registered).toEqual([
        "chat:opened",
        "chat:closed",
        "message:received",
      ]);
    });
  });

  describe("when crisp is absent", () => {
    /** @scenario Builds without Crisp are unaffected */
    it("re-asserts and toggles without throwing and without creating a queue", () => {
      expect(() => {
        assertCrispChatHidden();
        toggleSupportChat();
      }).not.toThrow();

      expect(isSuppressed()).toBe(true);
      expect(crispGlobals().$crisp).toBeUndefined();
    });
  });

  describe("when the policy is torn down", () => {
    it("stops re-asserting on the defensive triggers", () => {
      const fake = installFakeCrisp();
      const teardown = installPolicy();
      teardown();
      uninstall = undefined;
      const before = hideCount(fake);

      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("focus"));

      expect(hideCount(fake)).toBe(before);
    });
  });
});
