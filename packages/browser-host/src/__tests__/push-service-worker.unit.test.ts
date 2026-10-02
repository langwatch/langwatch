/**
 * The Web Push service worker's handlers over a fake worker scope.
 * Spec: specs/langy/langy-notifications.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  handleNotificationClick,
  handlePush,
  PUSH_OPEN_MESSAGE,
  PUSH_SHOWS_MESSAGE,
  type PushWindowClient,
  type PushWorkerScope,
} from "../push-service-worker.ts";

const ORIGIN = "https://app.acme.test";
const PAYLOAD = {
  title: "Langy finished",
  body: 'Done with "Weekly costs".',
  url: "/acme?langyConversation=conversation-1",
  tag: "langy:conversation-1",
};

/** A tab that answers the worker's questions with `handled`. */
function tab({
  focused = true,
  visibilityState = "visible",
  handled = false,
}: {
  focused?: boolean;
  visibilityState?: string;
  handled?: boolean;
} = {}) {
  const received: unknown[] = [];
  const client: PushWindowClient & { received: unknown[] } = {
    url: `${ORIGIN}/acme`,
    focused,
    visibilityState,
    received,
    postMessage: (message, [port]) => {
      received.push(message);
      port?.postMessage({ handled });
    },
    focus: vi.fn(async () => client),
    navigate: vi.fn(async () => client),
  };
  return client;
}

function scope(clients: PushWindowClient[]) {
  const shown: { title: string; options: unknown }[] = [];
  const opened: string[] = [];
  const worker: PushWorkerScope = {
    origin: ORIGIN,
    matchWindowClients: async () => clients,
    openWindow: async (url) => {
      opened.push(url);
      return null;
    },
    showNotification: async (title, options) => {
      shown.push({ title, options });
    },
    createChannel: () => new MessageChannel(),
  };
  return { worker, shown, opened };
}

describe("given a push for a conversation", () => {
  describe("when no visible tab shows it", () => {
    /** @scenario "A push for a conversation no visible tab shows is shown" */
    it("shows the notification with its title, body and tag", async () => {
      const hidden = tab({ focused: false, visibilityState: "hidden" });
      const { worker, shown } = scope([hidden, tab({ handled: false })]);

      await handlePush(worker, PAYLOAD);

      expect(shown).toEqual([
        {
          title: "Langy finished",
          options: { body: PAYLOAD.body, tag: PAYLOAD.tag, data: PAYLOAD },
        },
      ]);
      expect(hidden.received).toEqual([]);
    });
  });

  describe("when a visible, focused tab shows it", () => {
    /** @scenario "A push for a conversation a visible tab shows is skipped" */
    it("shows nothing", async () => {
      const watching = tab({ handled: true });
      const { worker, shown } = scope([watching]);

      await handlePush(worker, PAYLOAD);

      expect(watching.received).toEqual([{ type: PUSH_SHOWS_MESSAGE, tag: PAYLOAD.tag }]);
      expect(shown).toEqual([]);
    });
  });

  describe("when two LangWatch tabs are open and neither shows it", () => {
    /** @scenario "A push with two LangWatch tabs open shows once" */
    it("shows one notification, and no tab shows one of its own", async () => {
      const first = tab({ focused: false, visibilityState: "hidden" });
      const second = tab({ focused: false, visibilityState: "visible" });
      const { worker, shown } = scope([first, second]);

      await handlePush(worker, PAYLOAD);

      expect(shown).toHaveLength(1);
    });
  });

  it("ignores a push that carries nothing to show", async () => {
    const { worker, shown } = scope([]);

    await handlePush(worker, { body: "no title" });

    expect(shown).toEqual([]);
  });
});

describe("given a shown notification", () => {
  /** @scenario "Clicking a push focuses a LangWatch tab and opens the conversation" */
  it("focuses an open tab and hands it the link", async () => {
    const open = tab({ handled: true });
    const { worker, opened } = scope([open]);

    await handleNotificationClick(worker, PAYLOAD);

    expect(open.focus).toHaveBeenCalled();
    expect(open.received).toEqual([
      { type: PUSH_OPEN_MESSAGE, tag: PAYLOAD.tag, url: `${ORIGIN}${PAYLOAD.url}` },
    ]);
    expect(open.navigate).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it("sends a tab that cannot open it to the link", async () => {
    const other = tab({ handled: false });
    const { worker } = scope([other]);

    await handleNotificationClick(worker, PAYLOAD);

    expect(other.navigate).toHaveBeenCalledWith(`${ORIGIN}${PAYLOAD.url}`);
  });

  it("opens a new tab at the link when none is open", async () => {
    const { worker, opened } = scope([]);

    await handleNotificationClick(worker, PAYLOAD);

    expect(opened).toEqual([`${ORIGIN}${PAYLOAD.url}`]);
  });

  it("never leaves the installation's origin", async () => {
    const { worker, opened } = scope([]);

    await handleNotificationClick(worker, { ...PAYLOAD, url: "https://evil.acme.test/x" });

    expect(opened).toEqual([`${ORIGIN}/`]);
  });
});
