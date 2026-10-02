/**
 * The browser notifications capability over a stubbed Notification API.
 * @see specs/langy/langy-notifications.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isPageAway,
  readBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  showBrowserNotification,
} from "../browser-notifications.ts";

type Shown = { title: string; options: { body?: string; tag?: string }; close: () => void };

function installNotification({
  permission,
  answer = permission,
}: {
  permission: NotificationPermission;
  answer?: NotificationPermission;
}) {
  const shown: (Shown & { onclick: (() => void) | null })[] = [];
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = answer;
      return answer;
    });
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(
      readonly title: string,
      readonly options: { body?: string; tag?: string },
    ) {
      shown.push(this);
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  return { shown, FakeNotification };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser notifications", () => {
  describe("given a browser with no Notification API", () => {
    beforeEach(() => vi.stubGlobal("Notification", undefined));

    it("reads unsupported and shows nothing", async () => {
      expect(readBrowserNotificationPermission()).toBe("unsupported");
      await expect(requestBrowserNotificationPermission()).resolves.toBe("unsupported");
      expect(showBrowserNotification({ title: "Done" })).toBe(false);
    });
  });

  describe("given the browser was never asked", () => {
    it("asks and answers what the person chose", async () => {
      const { FakeNotification } = installNotification({
        permission: "default",
        answer: "granted",
      });

      expect(readBrowserNotificationPermission()).toBe("default");
      await expect(requestBrowserNotificationPermission()).resolves.toBe("granted");
      expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    });

    it("shows nothing until permission is granted", () => {
      const { shown } = installNotification({ permission: "default" });

      expect(showBrowserNotification({ title: "Done" })).toBe(false);
      expect(shown).toHaveLength(0);
    });
  });

  describe("given the browser blocked notifications", () => {
    it("reads denied and shows nothing", () => {
      const { shown } = installNotification({ permission: "denied" });

      expect(readBrowserNotificationPermission()).toBe("denied");
      expect(showBrowserNotification({ title: "Done" })).toBe(false);
      expect(shown).toHaveLength(0);
    });
  });

  describe("given the browser allows notifications", () => {
    describe("when one is shown and clicked", () => {
      it("focuses the tab, closes it and runs the feature's click", () => {
        const { shown } = installNotification({ permission: "granted" });
        const focus = vi.fn();
        vi.stubGlobal("focus", focus);
        const onClick = vi.fn();

        expect(
          showBrowserNotification({ title: "Langy finished", body: "Done", tag: "t", onClick }),
        ).toBe(true);
        const notification = shown[0];
        expect(notification?.title).toBe("Langy finished");
        expect(notification?.options).toEqual({ body: "Done", tag: "t" });

        notification?.onclick?.();

        expect(focus).toHaveBeenCalledOnce();
        expect(notification?.close).toHaveBeenCalledOnce();
        expect(onClick).toHaveBeenCalledOnce();
      });
    });
  });
});

describe("isPageAway", () => {
  function stubDocument({ hidden, focused }: { hidden: boolean; focused: boolean }) {
    vi.stubGlobal("document", {
      visibilityState: hidden ? "hidden" : "visible",
      hasFocus: () => focused,
    });
  }

  it("is away when the tab is hidden", () => {
    stubDocument({ hidden: true, focused: false });
    expect(isPageAway()).toBe(true);
  });

  it("is away when the tab is visible but the window lost focus", () => {
    stubDocument({ hidden: false, focused: false });
    expect(isPageAway()).toBe(true);
  });

  it("is present when the tab is visible and focused", () => {
    stubDocument({ hidden: false, focused: true });
    expect(isPageAway()).toBe(false);
  });
});
