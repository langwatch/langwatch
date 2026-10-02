/**
 * This browser's Web Push subscription over a fake push manager.
 * Spec: specs/langy/langy-notifications.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A 65-byte P-256 public key, base64url, the shape a VAPID key has. */
const KEY = Buffer.from(new Uint8Array(65).fill(4)).toString("base64url");

/** The members of a PushSubscription the page reads. */
interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer };
  toJSON(): { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe(): Promise<boolean>;
}

/** A push manager that, like a real one under a race, registers a new endpoint per call. */
function fakePushManager() {
  let current: FakeSubscription | null = null;
  let made = 0;
  const subscribe = vi.fn(async (options: { applicationServerKey: Uint8Array<ArrayBuffer> }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    made += 1;
    const endpoint = `https://fcm.googleapis.com/fcm/send/endpoint-${made}`;
    const subscription: FakeSubscription = {
      endpoint,
      options: { applicationServerKey: options.applicationServerKey.buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: "p256dh", auth: "auth" } }),
      unsubscribe: vi.fn(async () => true),
    };
    current = subscription;
    return subscription;
  });
  return {
    subscribe,
    getSubscription: vi.fn(async () => current),
  };
}

describe("ensureWebPushSubscription", () => {
  let pushManager: ReturnType<typeof fakePushManager>;

  beforeEach(() => {
    vi.resetModules();
    pushManager = fakePushManager();
    const registration = { pushManager };
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal("Notification", function Notification() {});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: vi.fn(async () => registration),
        ready: Promise.resolve(registration),
        addEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  describe("when the browser is asked twice at once", () => {
    it("subscribes once and answers both with the same endpoint", async () => {
      const { ensureWebPushSubscription } = await import("../web-push.ts");

      const [first, second] = await Promise.all([
        ensureWebPushSubscription(KEY),
        ensureWebPushSubscription(KEY),
      ]);

      expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
      expect(first?.endpoint).toBe("https://fcm.googleapis.com/fcm/send/endpoint-1");
      expect(second?.endpoint).toBe(first?.endpoint);
    });
  });

  describe("when the browser already holds a subscription for the key", () => {
    it("reuses it", async () => {
      const { ensureWebPushSubscription } = await import("../web-push.ts");

      const first = await ensureWebPushSubscription(KEY);
      const again = await ensureWebPushSubscription(KEY);

      expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
      expect(again?.endpoint).toBe(first?.endpoint);
    });
  });
});
