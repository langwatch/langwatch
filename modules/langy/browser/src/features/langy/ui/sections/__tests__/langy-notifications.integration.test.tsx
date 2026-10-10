import type * as webPushModule from "@langwatch/browser-host/web-push";
import { Menu } from "@langwatch/design-system/menu";
/**
 * @vitest-environment jsdom
 * The offer card and the menu's Notifications item, over stubbed Notification and Web Push.
 * @see specs/langy/langy-notifications.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({
  choice: null as "enabled" | "declined" | null,
  loading: false,
}));
const save = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => ({
  subscribed: [] as unknown[],
  forgotten: [] as unknown[],
  browserEndpoint: null as string | null,
}));

vi.mock("@langwatch/browser-host/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof webPushModule>();
  return {
    ...actual,
    checkWebPushSupport: () => true,
    ensureWebPushSubscription: async (publicKey: string) => {
      push.browserEndpoint = `https://fcm.googleapis.com/fcm/send/${publicKey}`;
      return { endpoint: push.browserEndpoint, keys: { p256dh: "p256dh", auth: "auth" } };
    },
    removeWebPushSubscription: async () => {
      const endpoint = push.browserEndpoint;
      push.browserEndpoint = null;
      return endpoint;
    },
  };
});

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({
      user: { getNotificationPreference: { setData: vi.fn() } },
      notification: { webPushPublicKey: { fetch: async () => ({ publicKey: "vapid-key" }) } },
    }),
    notification: {
      subscribeWebPush: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            push.subscribed.push(input);
          },
        }),
      },
      unsubscribeWebPush: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            push.forgotten.push(input);
          },
        }),
      },
    },
    user: {
      getNotificationPreference: {
        useQuery: () => ({
          data: stored.loading ? undefined : { topic: "langy", choice: stored.choice },
          isLoading: stored.loading,
        }),
      },
      setNotificationPreference: {
        useMutation: () => ({
          mutateAsync: async (input: { topic: "langy"; choice: "enabled" | "declined" }) => {
            save(input);
            stored.choice = input.choice;
            return input;
          },
          isPending: false,
        }),
      },
    },
  },
}));

import { LangyNotificationsMenuGroup } from "../langy-notifications-menu-group.tsx";
import {
  LANGY_NOTIFICATIONS_BLOCKED_LINE,
  LANGY_NOTIFICATIONS_DECLINE_LABEL,
  LANGY_NOTIFICATIONS_DECLINED_LINE,
  LANGY_NOTIFICATIONS_ENABLE_LABEL,
  LANGY_NOTIFICATIONS_ENABLED_LINE,
  LANGY_NOTIFICATIONS_OFFER_QUESTION,
  LangyNotificationsOfferCard,
} from "../langy-notifications-offer-card.tsx";

function installNotification({
  permission,
  answer = permission,
}: {
  permission: NotificationPermission;
  answer?: NotificationPermission;
}) {
  const requestPermission = vi.fn(async () => {
    FakeNotification.permission = answer;
    return answer;
  });
  class FakeNotification {
    static permission: NotificationPermission = permission;
    static requestPermission = requestPermission;
  }
  vi.stubGlobal("Notification", FakeNotification);
  return { requestPermission };
}

const renderCard = () =>
  render(
    <DesignSystemProvider forcedTheme="light">
      <LangyNotificationsOfferCard />
    </DesignSystemProvider>,
  );

const renderMenu = () =>
  render(
    <DesignSystemProvider forcedTheme="light">
      <Menu.Root open>
        <Menu.Trigger>More</Menu.Trigger>
        <Menu.Content>
          <LangyNotificationsMenuGroup />
        </Menu.Content>
      </Menu.Root>
    </DesignSystemProvider>,
  );

// The menu positions itself with a ResizeObserver, which jsdom does not have.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  stored.choice = null;
  stored.loading = false;
  save.mockClear();
  push.subscribed = [];
  push.forgotten = [];
  push.browserEndpoint = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the notifications offer card", () => {
  describe("given I have not chosen about Langy notifications yet", () => {
    /** @scenario "The offer appears after the folder is shared" */
    it("asks with the two buttons", () => {
      installNotification({ permission: "default" });
      renderCard();

      expect(screen.getByText(LANGY_NOTIFICATIONS_OFFER_QUESTION)).toBeDefined();
      expect(screen.getByRole("button", { name: LANGY_NOTIFICATIONS_ENABLE_LABEL })).toBeDefined();
      expect(screen.getByRole("button", { name: LANGY_NOTIFICATIONS_DECLINE_LABEL })).toBeDefined();
    });

    describe("when I click Enable notifications and the browser grants permission", () => {
      /** @scenario "Enabling asks the browser and turns Langy notifications on" */
      it("stores enabled and settles on the enabled line", async () => {
        const { requestPermission } = installNotification({
          permission: "default",
          answer: "granted",
        });
        const view = renderCard();

        fireEvent.click(screen.getByRole("button", { name: LANGY_NOTIFICATIONS_ENABLE_LABEL }));

        await waitFor(() =>
          expect(save).toHaveBeenCalledWith({ topic: "langy", choice: "enabled" }),
        );
        expect(requestPermission).toHaveBeenCalledOnce();
        view.rerender(
          <DesignSystemProvider forcedTheme="light">
            <LangyNotificationsOfferCard />
          </DesignSystemProvider>,
        );
        expect(await screen.findByText(LANGY_NOTIFICATIONS_ENABLED_LINE)).toBeDefined();
      });

      /** @scenario "Enabling subscribes this browser" */
      it("subscribes this browser with the installation's key and stores it on the server", async () => {
        installNotification({ permission: "default", answer: "granted" });
        renderCard();

        fireEvent.click(screen.getByRole("button", { name: LANGY_NOTIFICATIONS_ENABLE_LABEL }));

        await waitFor(() =>
          expect(push.subscribed).toEqual([
            expect.objectContaining({
              endpoint: "https://fcm.googleapis.com/fcm/send/vapid-key",
              keys: { p256dh: "p256dh", auth: "auth" },
            }),
          ]),
        );
      });
    });

    describe("when I click Enable notifications and the browser blocks them", () => {
      it("stores nothing and says how to allow them", async () => {
        installNotification({ permission: "default", answer: "denied" });
        renderCard();

        fireEvent.click(screen.getByRole("button", { name: LANGY_NOTIFICATIONS_ENABLE_LABEL }));

        expect(await screen.findByText(LANGY_NOTIFICATIONS_BLOCKED_LINE)).toBeDefined();
        expect(save).not.toHaveBeenCalled();
      });
    });

    describe("when I click No thanks", () => {
      /** @scenario "Declining records the choice and settles the card" */
      it("stores declined without asking the browser", async () => {
        const { requestPermission } = installNotification({ permission: "default" });
        const view = renderCard();

        fireEvent.click(screen.getByRole("button", { name: LANGY_NOTIFICATIONS_DECLINE_LABEL }));

        await waitFor(() =>
          expect(save).toHaveBeenCalledWith({ topic: "langy", choice: "declined" }),
        );
        expect(requestPermission).not.toHaveBeenCalled();
        view.rerender(
          <DesignSystemProvider forcedTheme="light">
            <LangyNotificationsOfferCard />
          </DesignSystemProvider>,
        );
        expect(screen.getByText(LANGY_NOTIFICATIONS_DECLINED_LINE)).toBeDefined();
      });
    });
  });

  describe("given I already turned Langy notifications on", () => {
    /** @scenario "A card whose question was already answered shows the answer" */
    it("shows no buttons after a reload, only that they are on", () => {
      stored.choice = "enabled";
      installNotification({ permission: "granted" });
      renderCard();

      expect(screen.getByText(LANGY_NOTIFICATIONS_ENABLED_LINE)).toBeDefined();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("given the answer has not been read yet", () => {
    it("renders nothing rather than offering what may be answered", () => {
      stored.loading = true;
      installNotification({ permission: "default" });
      renderCard();

      expect(screen.queryByTestId("langy-notifications-offer-card")).toBeNull();
    });
  });
});

describe("the Notifications section of Langy's menu", () => {
  describe("given the browser allows notifications and Langy notifications are off", () => {
    /** @scenario "The menu toggles Langy notifications" */
    it("turns them on and shows a check", async () => {
      installNotification({ permission: "granted" });
      const view = renderMenu();

      fireEvent.click(await screen.findByText("Notifications", { selector: "p" }));

      await waitFor(() => expect(save).toHaveBeenCalledWith({ topic: "langy", choice: "enabled" }));
      view.rerender(
        <DesignSystemProvider forcedTheme="light">
          <Menu.Root open>
            <Menu.Trigger>More</Menu.Trigger>
            <Menu.Content>
              <LangyNotificationsMenuGroup />
            </Menu.Content>
          </Menu.Root>
        </DesignSystemProvider>,
      );
      expect(await screen.findByTestId("langy-notifications-on")).toBeDefined();
    });
  });

  describe("given Langy notifications are on and this browser is subscribed", () => {
    /** @scenario "Turning notifications off unsubscribes this browser" */
    it("removes this browser's subscription and stores declined", async () => {
      stored.choice = "enabled";
      push.browserEndpoint = "https://fcm.googleapis.com/fcm/send/laptop";
      installNotification({ permission: "granted" });
      renderMenu();

      fireEvent.click(await screen.findByText("Notifications", { selector: "p" }));

      await waitFor(() =>
        expect(push.forgotten).toEqual([
          { endpoint: "https://fcm.googleapis.com/fcm/send/laptop" },
        ]),
      );
      expect(save).toHaveBeenCalledWith({ topic: "langy", choice: "declined" });
      expect(push.browserEndpoint).toBeNull();
    });
  });

  describe("given the browser blocked notifications for this site", () => {
    /** @scenario "The menu says when the browser blocked notifications" */
    it("says so and how to allow them again", async () => {
      installNotification({ permission: "denied" });
      renderMenu();

      expect(await screen.findByText("Blocked by your browser")).toBeDefined();
      expect(screen.getByText(/allow notifications for this site/)).toBeDefined();
    });
  });
});
