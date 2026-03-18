import { beforeEach, describe, it, expect, vi } from "vitest";
import { NurturingService } from "./nurturing.service";
import type { CioBatchCall } from "./types";

// Suppress logger output and captureException in tests
vi.mock("../../../src/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function createMockFetch(
  response: Partial<Response> = { ok: true, status: 200 },
) {
  return vi.fn().mockResolvedValue(response);
}

function createService({
  apiKey = "test-api-key",
  region = "us" as "us" | "eu",
  fetchFn = createMockFetch(),
} = {}) {
  return {
    service: NurturingService.create({
      config: { customerIoApiKey: apiKey, customerIoRegion: region },
      fetchFn,
    }),
    fetchFn,
  };
}

describe("NurturingService", () => {
  describe("identifyUser()", () => {
    describe("when created with an API key and region 'us'", () => {
      it("sends HTTP request to cdp.customer.io/v1/identify with Basic Auth", async () => {
        const { service, fetchFn } = createService();

        await service.identifyUser({ userId: "user-123", traits: { email: "test@example.com" } });

        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, options] = fetchFn.mock.calls[0]!;
        expect(url).toBe("https://cdp.customer.io/v1/identify");
        expect(options.method).toBe("POST");

        const authHeader = options.headers["Authorization"];
        const expectedAuth =
          "Basic " + Buffer.from("test-api-key:").toString("base64");
        expect(authHeader).toBe(expectedAuth);
      });

      it("includes user ID and traits in the request body", async () => {
        const { service, fetchFn } = createService();

        await service.identifyUser({ userId: "user-123", traits: {
          email: "test@example.com",
          name: "Jane Doe",
        }});

        const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
        expect(body).toEqual({
          userId: "user-123",
          traits: { email: "test@example.com", name: "Jane Doe" },
        });
      });
    });

    describe("when created with region 'eu'", () => {
      it("sends request to cdp-eu.customer.io/v1/identify", async () => {
        const { service, fetchFn } = createService({ region: "eu" });

        await service.identifyUser({ userId: "user-123", traits: { email: "test@example.com" } });

        const [url] = fetchFn.mock.calls[0]!;
        expect(url).toBe("https://cdp-eu.customer.io/v1/identify");
      });
    });
  });

  describe("trackEvent()", () => {
    describe("when called with user ID, event name, and properties", () => {
      it("sends event payload to the track endpoint", async () => {
        const { service, fetchFn } = createService();

        await service.trackEvent({ userId: "user-123", event: "signed_up", properties: {
          role: "engineer",
        }});

        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, options] = fetchFn.mock.calls[0]!;
        expect(url).toBe("https://cdp.customer.io/v1/track");
        expect(options.method).toBe("POST");

        const body = JSON.parse(options.body);
        expect(body).toEqual({
          userId: "user-123",
          name: "signed_up",
          data: { role: "engineer" },
        });
      });
    });
  });

  describe("groupUser()", () => {
    describe("when called with user ID, group ID, and org traits", () => {
      it("sends org traits to the group endpoint", async () => {
        const { service, fetchFn } = createService();

        await service.groupUser({ userId: "user-123", groupId: "org-456", traits: {
          name: "Acme Corp",
          plan: "free",
        }});

        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, options] = fetchFn.mock.calls[0]!;
        expect(url).toBe("https://cdp.customer.io/v1/group");
        expect(options.method).toBe("POST");

        const body = JSON.parse(options.body);
        expect(body).toEqual({
          userId: "user-123",
          groupId: "org-456",
          traits: { name: "Acme Corp", plan: "free" },
        });
      });
    });
  });

  describe("batch()", () => {
    describe("when called with multiple identify and track calls", () => {
      it("sends a single HTTP request to the batch endpoint containing all calls", async () => {
        const { service, fetchFn } = createService();

        const calls: CioBatchCall[] = [
          {
            type: "identify",
            userId: "user-1",
            traits: { email: "a@b.com" },
          },
          {
            type: "track",
            userId: "user-1",
            event: "signed_up",
            properties: { role: "admin" },
          },
          {
            type: "group",
            userId: "user-1",
            groupId: "org-1",
            traits: { name: "Org" },
          },
        ];

        await service.batch(calls);

        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, options] = fetchFn.mock.calls[0]!;
        expect(url).toBe("https://cdp.customer.io/v1/batch");
        expect(options.method).toBe("POST");

        const body = JSON.parse(options.body);
        expect(body).toEqual({
          batch: [
            {
              type: "identify",
              userId: "user-1",
              traits: { email: "a@b.com" },
            },
            {
              type: "track",
              userId: "user-1",
              name: "signed_up",
              data: { role: "admin" },
            },
            {
              type: "group",
              userId: "user-1",
              groupId: "org-1",
              traits: { name: "Org" },
            },
          ],
        });
      });
    });
  });

  describe("when the Customer.io API does not respond within 10 seconds", () => {
    it("aborts the request", async () => {
      const { captureException } = await import(
        "../../../src/utils/posthogErrorCapture"
      );
      const slowFetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_resolve, reject) => {
          // Simulate the abort signal triggering
          if (options?.signal) {
            options.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      });

      const service = NurturingService.create({
        config: { customerIoApiKey: "key", customerIoRegion: "us" },
        fetchFn: slowFetch as unknown as typeof fetch,
      });

      // Use fake timers to trigger the timeout immediately
      vi.useFakeTimers();
      const promise = service.identifyUser({ userId: "user-1", traits: { email: "a@b.com" } });
      vi.advanceTimersByTime(10_000);
      await promise;
      vi.useRealTimers();

      expect(captureException).toHaveBeenCalled();
    });
  });

  describe("when the Customer.io API returns a 500 error", () => {
    it("resolves without throwing", async () => {
      const { service } = createService({
        fetchFn: createMockFetch({ ok: false, status: 500 }),
      });

      await expect(
        service.identifyUser({ userId: "user-123", traits: { email: "test@example.com" } }),
      ).resolves.toBeUndefined();
    });

    it("captures the error for observability", async () => {
      const { captureException } = await import(
        "../../../src/utils/posthogErrorCapture"
      );
      const { service } = createService({
        fetchFn: createMockFetch({ ok: false, status: 500 }),
      });

      await service.identifyUser({ userId: "user-123", traits: { email: "test@example.com" } });

      expect(captureException).toHaveBeenCalled();
    });
  });

  describe("isEnabled", () => {
    describe("when created with a valid API key", () => {
      it("returns true", () => {
        const { service } = createService({ apiKey: "test-key" });
        expect(service.isEnabled).toBe(true);
      });
    });

    describe("when created with a falsy API key", () => {
      it("returns false", () => {
        const fetchFn = createMockFetch();
        const service = NurturingService.create({
          config: { customerIoApiKey: undefined, customerIoRegion: "us" },
          fetchFn,
        });
        expect(service.isEnabled).toBe(false);
      });
    });

    describe("when created via createNull()", () => {
      it("returns false", () => {
        const service = NurturingService.createNull();
        expect(service.isEnabled).toBe(false);
      });
    });
  });

  describe("when created via createNull()", () => {
    it("resolves identifyUser without making HTTP requests", async () => {
      const service = NurturingService.createNull();

      // Does not throw, returns void
      await expect(
        service.identifyUser({ userId: "user-123", traits: { email: "test@example.com" } }),
      ).resolves.toBeUndefined();
    });

    it("resolves trackEvent without making HTTP requests", async () => {
      const service = NurturingService.createNull();

      await expect(
        service.trackEvent({ userId: "user-123", event: "signed_up" }),
      ).resolves.toBeUndefined();
    });

    it("resolves groupUser without making HTTP requests", async () => {
      const service = NurturingService.createNull();

      await expect(
        service.groupUser({ userId: "user-123", groupId: "org-1" }),
      ).resolves.toBeUndefined();
    });

    it("resolves batch without making HTTP requests", async () => {
      const service = NurturingService.createNull();

      await expect(service.batch([])).resolves.toBeUndefined();
    });
  });

  describe("when created with a falsy API key", () => {
    it("behaves as a no-op without making HTTP requests", async () => {
      const fetchFn = createMockFetch();
      const service = NurturingService.create({
        config: { customerIoApiKey: undefined, customerIoRegion: "us" },
        fetchFn,
      });

      await service.identifyUser({ userId: "user-123", traits: { email: "test@example.com" } });

      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
