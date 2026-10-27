import type * as webPushModule from "@langwatch/browser-host/web-push";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @vitest-environment jsdom
 *
 * This browser's side of Langy's Web Push over a stubbed subscription, a mocked server and
 * the real Langy store: subscribing again on open, and answering the service worker.
 * @see specs/langy/langy-notifications.feature
 */
import { useLangyStore } from "../../../../behavior/langy.store.ts";

const server = vi.hoisted(() => ({
  choice: "enabled" as "enabled" | "declined" | null,
  subscribed: [] as unknown[],
  invalidated: 0,
  /** What storing a subscription fails with, when it fails. */
  saveError: null as unknown,
}));
const worker = vi.hoisted(() => ({
  handler: null as null | {
    shows(tag: string): boolean;
    open(input: { tag: string; url: string }): boolean;
  },
}));

vi.mock("@langwatch/browser-host/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof webPushModule>();
  return {
    ...actual,
    listenToWebPushWorker: (handler: NonNullable<typeof worker.handler>) => {
      worker.handler = handler;
      return () => {
        worker.handler = null;
      };
    },
  };
});

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", slug: "acme" } }),
}));

vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({
      notification: { webPushPublicKey: { fetch: async () => ({ publicKey: "dmFwaWQta2V5" }) } },
      langy: {
        messages: {
          invalidate: async () => {
            server.invalidated += 1;
          },
        },
      },
    }),
    user: {
      getNotificationPreference: {
        useQuery: () => ({ data: { topic: "langy", choice: server.choice }, isLoading: false }),
      },
    },
    notification: {
      subscribeWebPush: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            if (server.saveError) throw server.saveError;
            server.subscribed.push(input);
          },
        }),
      },
      unsubscribeWebPush: { useMutation: () => ({ mutateAsync: async () => undefined }) },
    },
  },
}));

import { readWebPushDeviceState } from "@langwatch/browser-host/web-push";

import { langyTabNotifies } from "../../../../model/langy-notifications.ts";
import { useLangyWebPush } from "../use-langy-web-push.ts";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/laptop";

/** A browser's Push API: whether it exists, and whether subscribing works. */
const browserPush = { supported: true, subscribeFails: false, held: null as null | object };

function fakeSubscription() {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: null },
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p256dh", auth: "auth" } }),
    unsubscribe: async () => {
      browserPush.held = null;
      return true;
    },
  };
}

function installBrowserPush() {
  const pushManager = {
    getSubscription: async () => browserPush.held,
    subscribe: async () => {
      if (browserPush.subscribeFails) throw new DOMException("push service error", "AbortError");
      browserPush.held = fakeSubscription();
      return browserPush.held;
    },
  };
  const registration = { pushManager };
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  if (browserPush.supported) {
    vi.stubGlobal("PushManager", function PushManager() {});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => registration,
        ready: Promise.resolve(registration),
        getRegistration: async () => registration,
        addEventListener: () => undefined,
      },
    });
  } else {
    vi.stubGlobal("PushManager", undefined);
  }
}

/** Whether a tab on this device notifies on its own, for a person who turned them on. */
function tabNotifies(): boolean {
  return langyTabNotifies({ choice: "enabled", pushDevice: readWebPushDeviceState() });
}

class GrantedNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = async () => "granted";
}

function setFocusedAndVisible(watching: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (watching ? "visible" : "hidden"),
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(watching);
}

beforeEach(() => {
  vi.stubGlobal("Notification", GrantedNotification);
  server.choice = "enabled";
  server.subscribed = [];
  server.invalidated = 0;
  server.saveError = null;
  browserPush.supported = true;
  browserPush.subscribeFails = false;
  browserPush.held = null;
  installBrowserPush();
  useLangyStore.setState({ isOpen: false, activeConversationId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("given Langy notifications are on and the browser allows them", () => {
  describe("when I open LangWatch", () => {
    /** @scenario "A browser already enabled subscribes again when it opens" */
    it("subscribes this browser and stores the subscription for me", async () => {
      renderHook(() => useLangyWebPush());

      await waitFor(() =>
        expect(server.subscribed).toEqual([
          expect.objectContaining({ endpoint: "https://fcm.googleapis.com/fcm/send/laptop" }),
        ]),
      );
      expect(readWebPushDeviceState()).toBe("subscribed");
    });
  });
});

describe("given a browser that holds a push subscription", () => {
  /** @scenario "A failed push or a failed save never makes the tab notify" */
  it("keeps the tab quiet when storing the subscription fails on the way", async () => {
    server.saveError = new TypeError("Failed to fetch");
    renderHook(() => useLangyWebPush());

    await waitFor(() => expect(browserPush.held).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readWebPushDeviceState()).toBe("subscribed");
    expect(tabNotifies()).toBe(false);
  });
});

describe("given a browser the server cannot push to", () => {
  /** @scenario "A browser without push support notifies from the tab" */
  it("notifies from the tab when the browser has no Push API", async () => {
    browserPush.supported = false;
    installBrowserPush();
    renderHook(() => useLangyWebPush());

    await waitFor(() => expect(readWebPushDeviceState()).toBe("unavailable"));
    expect(tabNotifies()).toBe(true);
    expect(server.subscribed).toEqual([]);
  });

  /** @scenario "A browser whose subscribing failed notifies from the tab" */
  it("notifies from the tab when the browser could not subscribe", async () => {
    browserPush.subscribeFails = true;
    renderHook(() => useLangyWebPush());

    await waitFor(() => expect(readWebPushDeviceState()).toBe("unavailable"));
    expect(tabNotifies()).toBe(true);
  });

  /** @scenario "A browser whose subscribing failed notifies from the tab" */
  it("notifies from the tab when the server refuses the browser's push service", async () => {
    server.saveError = { code: "web_push_endpoint_refused", httpStatus: 422 };
    renderHook(() => useLangyWebPush());

    await waitFor(() => expect(readWebPushDeviceState()).toBe("unavailable"));
    await waitFor(() => expect(browserPush.held).toBeNull());
    expect(tabNotifies()).toBe(true);
  });
});

describe("given I declined Langy notifications", () => {
  it("subscribes nothing", async () => {
    server.choice = "declined";
    renderHook(() => useLangyWebPush());

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.subscribed).toEqual([]);
  });
});

describe("the answers this tab gives the service worker", () => {
  it("says it shows a conversation only while focused, visible and open on it", () => {
    renderHook(() => useLangyWebPush());
    useLangyStore.setState({ isOpen: true, activeConversationId: "conversation-1" });

    setFocusedAndVisible(true);
    expect(worker.handler?.shows("langy:conversation-1")).toBe(true);
    expect(worker.handler?.shows("langy:conversation-2")).toBe(false);
    expect(worker.handler?.shows("billing:invoice-1")).toBe(false);

    setFocusedAndVisible(false);
    expect(worker.handler?.shows("langy:conversation-1")).toBe(false);
  });

  /** @scenario "Clicking a notification focuses the tab and opens the conversation" */
  it("opens the clicked conversation in this project's panel and refreshes it", () => {
    renderHook(() => useLangyWebPush());

    const handled = worker.handler?.open({
      tag: "langy:conversation-1",
      url: "https://app.acme.test/acme?langyConversation=conversation-1",
    });

    expect(handled).toBe(true);
    expect(useLangyStore.getState().isOpen).toBe(true);
    expect(useLangyStore.getState().activeConversationId).toBe("conversation-1");
    expect(server.invalidated).toBe(1);
  });

  it("leaves a conversation of another project to the link", () => {
    renderHook(() => useLangyWebPush());

    expect(
      worker.handler?.open({
        tag: "langy:conversation-1",
        url: "https://app.acme.test/other-project?langyConversation=conversation-1",
      }),
    ).toBe(false);
  });
});
