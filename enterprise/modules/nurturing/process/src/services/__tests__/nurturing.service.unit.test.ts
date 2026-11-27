import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpCustomerIoChannel } from "../../channels/http/http.customer-io.channel.ts";
import { NurturingService } from "../nurturing.service.ts";
import { peopleWithEmails } from "./nurturing-person-email.test-helpers.ts";

// Suppress logger output and captureException in tests
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createWarnThrottle: () => ({ claim: () => 0, reset: () => {} }),
}));
const FakeErrorReporter = {
  create: () => ({ capture: vi.fn<(error: Error, context?: Record<string, unknown>) => void>() }),
};

beforeEach(() => {
  vi.clearAllMocks();
});

function createMockFetch(response: Partial<Response> = { ok: true, status: 200 }) {
  return vi.fn().mockResolvedValue(response);
}

function createService({
  apiKey = "test-api-key",
  region = "us" as "us" | "eu",
  fetchFn = createMockFetch(),
  emails = {} as Readonly<Record<string, string | null>>,
  reads = [] as string[][],
  users = peopleWithEmails({ emails, reads }),
} = {}) {
  const errorReporter = FakeErrorReporter.create();
  return {
    reads,
    service: NurturingService.create({
      users,
      channel: HttpCustomerIoChannel.create({
        config: { customerIoApiKey: apiKey, customerIoRegion: region },
        fetchFn,
        errorReporter,
      }),
    }),
    fetchFn,
    errorReporter,
  };
}

describe("NurturingService", () => {
  describe("identifyUser()", () => {
    describe("when created with an API key and region 'us'", () => {
      /** @scenario 'Identify call authenticates with Basic Auth using the configured API key' */
      it("sends HTTP request to cdp.customer.io/v1/identify with Basic Auth", async () => {
        const { service, fetchFn } = createService();

        await service.identifyUser({
          userId: "user-123",
          traits: { email: "test@example.com" },
        });

        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, options] = fetchFn.mock.calls[0]!;
        expect(url).toBe("https://cdp.customer.io/v1/identify");
        expect(options.method).toBe("POST");

        const authHeader = options.headers.Authorization;
        const expectedAuth = "Basic " + Buffer.from("test-api-key:").toString("base64");
        expect(authHeader).toBe(expectedAuth);
      });

      it("includes user ID and traits in the request body", async () => {
        const { service, fetchFn } = createService({ emails: { "user-123": "test@example.com" } });

        await service.identifyUser({
          userId: "user-123",
          traits: {
            email: "test@example.com",
            name: "Jane Doe",
          },
        });

        const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
        expect(body).toEqual({
          userId: "user-123",
          traits: { email: "test@example.com", name: "Jane Doe" },
        });
      });
    });

    describe("when created with region 'eu'", () => {
      /** @scenario 'Identify call routes to EU endpoint when region is eu' */
      it("sends request to cdp-eu.customer.io/v1/identify", async () => {
        const { service, fetchFn } = createService({ region: "eu" });

        await service.identifyUser({
          userId: "user-123",
          traits: { email: "test@example.com" },
        });

        const [url] = fetchFn.mock.calls[0]!;
        expect(url).toBe("https://cdp-eu.customer.io/v1/identify");
      });
    });
  });

  describe("trackEvent()", () => {
    describe("when called with user ID, event name, and properties", () => {
      /** @scenario 'Track call sends event payload to Customer.io' */
      /** @scenario "A Customer.io track goes behind an identify that carries the person's email" */
      it("sends the identify with the person's email in its own batch, then the track", async () => {
        const { service, fetchFn } = createService();

        await service.trackEvent({
          userId: "user-123",
          event: "signed_up",
          properties: {
            role: "engineer",
          },
        });

        expect(fetchFn).toHaveBeenCalledTimes(2);
        const [url, options] = fetchFn.mock.calls[0]!;
        expect(url).toBe("https://cdp.customer.io/v1/batch");
        expect(options.method).toBe("POST");

        expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toEqual({
          batch: [
            { type: "identify", userId: "user-123", traits: { email: "user-123@example.com" } },
          ],
        });
        expect(JSON.parse(fetchFn.mock.calls[1]![1].body)).toEqual({
          batch: [
            {
              type: "track",
              userId: "user-123",
              event: "signed_up",
              properties: { role: "engineer" },
            },
          ],
        });
      });

      /** @scenario "A Customer.io track is held back when its identify is not taken" */
      it("sends no track when the identify is not taken, and does not reject", async () => {
        const { service, fetchFn } = createService({
          fetchFn: createMockFetch({ ok: false, status: 500 }),
        });

        await expect(
          service.trackEvent({ userId: "user-123", event: "signed_up" }),
        ).resolves.toBeUndefined();

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(
          JSON.parse(fetchFn.mock.calls[0]![1].body).batch.map((c: { type: string }) => c.type),
        ).toEqual(["identify"]);
      });
    });

    describe("when the person has no email", () => {
      /** @scenario "A Customer.io track goes behind an identify that carries the person's email" */
      it("sends nothing, so no profile is created without one", async () => {
        const { service, fetchFn } = createService({ emails: { "user-123": null } });

        await service.trackEvent({ userId: "user-123", event: "signed_up" });

        expect(fetchFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a person nurturing identifies", () => {
    describe("when the user module holds their email", () => {
      /** @scenario "Every Customer.io identify carries the person's email, or is not sent" */
      it("sends the identify with the email read fresh", async () => {
        const { service, fetchFn } = createService({ emails: { "user-1": "jane@example.com" } });

        await service.identifyUser({ userId: "user-1", traits: { has_traces: true } });

        expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toEqual({
          userId: "user-1",
          traits: { has_traces: true, email: "jane@example.com" },
        });
      });
    });

    describe("when the person has no email, or the user module does not know them", () => {
      /** @scenario "Every Customer.io identify carries the person's email, or is not sent" */
      it("sends no identify", async () => {
        const { service, fetchFn } = createService({ emails: { "user-1": null } });

        await service.identifyUser({ userId: "user-1", traits: { has_traces: true } });

        expect(fetchFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("groupUser()", () => {
    describe("when called with user ID, group ID, and org traits", () => {
      /** @scenario 'Group call sends organization traits to Customer.io' */
      it("sends org traits to the group endpoint", async () => {
        const { service, fetchFn } = createService();

        await service.groupUser({
          userId: "user-123",
          groupId: "org-456",
          traits: {
            name: "Acme Corp",
            plan: "free",
          },
        });

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
      /** @scenario 'Batch call combines multiple operations into a single request' */
      it("sends the identifies in one batch first, then the track and group in a second", async () => {
        const { service, fetchFn } = createService({ emails: { "user-1": "a@b.com" } });

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

        expect(fetchFn).toHaveBeenCalledTimes(2);
        const [url, options] = fetchFn.mock.calls[0]!;
        expect(url).toBe("https://cdp.customer.io/v1/batch");
        expect(options.method).toBe("POST");

        expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toEqual({
          batch: [{ type: "identify", userId: "user-1", traits: { email: "a@b.com" } }],
        });
        expect(JSON.parse(fetchFn.mock.calls[1]![1].body)).toEqual({
          batch: [
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
          ],
        });
      });
    });
  });

  describe("when batch() identifies several people", () => {
    /** @scenario "Every Customer.io identify carries the person's email, or is not sent" */
    it("reads every address in one query and drops the person with none", async () => {
      const { service, fetchFn, reads } = createService({ emails: { "user-2": null } });

      await service.batch([
        { type: "identify", userId: "user-1", traits: { has_traces: true } },
        { type: "identify", userId: "user-2", traits: { has_traces: true } },
        { type: "identify", userId: "user-3", traits: { has_traces: true } },
      ]);

      expect(reads).toEqual([["user-1", "user-2", "user-3"]]);
      expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toEqual({
        batch: [
          {
            type: "identify",
            userId: "user-1",
            traits: { has_traces: true, email: "user-1@example.com" },
          },
          {
            type: "identify",
            userId: "user-3",
            traits: { has_traces: true, email: "user-3@example.com" },
          },
        ],
      });
    });

    it("sends no request when no one in it has an email", async () => {
      const { service, fetchFn } = createService({ emails: { "user-1": null } });

      await service.batchOrThrow([{ type: "identify", userId: "user-1", traits: {} }]);

      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe("when the Customer.io API does not respond within 10 seconds", () => {
    /** @scenario 'NurturingService enforces a 10-second request timeout' */
    it("aborts the request", async () => {
      const errorReporter = FakeErrorReporter.create();
      const slowFetch = vi.fn<typeof fetch>().mockImplementation((_url, options) => {
        return new Promise<Response>((_resolve, reject) => {
          // Simulate the abort signal triggering
          if (options?.signal) {
            options.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      });

      const service = NurturingService.create({
        users: peopleWithEmails(),
        channel: HttpCustomerIoChannel.create({
          config: { customerIoApiKey: "key", customerIoRegion: "us" },
          fetchFn: slowFetch,
          errorReporter,
        }),
      });

      // Use fake timers to trigger the timeout immediately
      vi.useFakeTimers();
      const promise = service.identifyUser({
        userId: "user-1",
        traits: { email: "a@b.com" },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;
      vi.useRealTimers();

      expect(errorReporter.capture).toHaveBeenCalled();
    });
  });

  describe("when the Customer.io API returns a 500 error", () => {
    /** @scenario 'NurturingService swallows API errors without throwing' */
    it("resolves without throwing", async () => {
      const { service } = createService({
        fetchFn: createMockFetch({ ok: false, status: 500 }),
      });

      await expect(
        service.identifyUser({
          userId: "user-123",
          traits: { email: "test@example.com" },
        }),
      ).resolves.toBeUndefined();
    });

    it("captures the error for observability", async () => {
      const { service, errorReporter } = createService({
        fetchFn: createMockFetch({ ok: false, status: 500 }),
      });

      await service.identifyUser({
        userId: "user-123",
        traits: { email: "test@example.com" },
      });

      expect(errorReporter.capture).toHaveBeenCalled();
    });
  });

  describe("when created with no region", () => {
    /** @scenario 'Region defaults to EU when CUSTOMER_IO_REGION is not set' */
    it("defaults to the EU regional endpoint", async () => {
      const fetchFn = createMockFetch();
      const service = NurturingService.create({
        users: peopleWithEmails(),
        channel: HttpCustomerIoChannel.create({
          config: { customerIoApiKey: "key", customerIoRegion: undefined },
          fetchFn,
        }),
      });

      await service.identifyUser({ userId: "user-1", traits: { email: "a@b.com" } });

      expect(fetchFn.mock.calls[0]?.[0]).toContain("cdp-eu.customer.io");
    });
  });

  describe("given the user module fails the address read", () => {
    const readFailure = new Error("user module unavailable");
    const failingUsers = () =>
      createApiFixture<UserApi>({
        getProfiles: async () => {
          throw readFailure;
        },
      });

    describe("when a fire-and-forget call is sent", () => {
      /** @scenario "Every Customer.io identify carries the person's email, or is not sent" */
      it("resolves and sends nothing", async () => {
        const { service, fetchFn } = createService({ users: failingUsers() });

        await expect(
          service.identifyUser({ userId: "user-1", traits: { has_traces: true } }),
        ).resolves.toBeUndefined();
        await expect(
          service.trackEvent({ userId: "user-1", event: "signed_up" }),
        ).resolves.toBeUndefined();
        await expect(
          service.batch([{ type: "identify", userId: "user-1", traits: {} }]),
        ).resolves.toBeUndefined();

        expect(fetchFn).not.toHaveBeenCalled();
      });
    });

    describe("when an OrThrow call is sent", () => {
      /** @scenario "A Customer.io track is held back when its identify is not taken" */
      it("rejects with the failure and sends no track when the identify is not taken", async () => {
        const fetchFn = createMockFetch({ ok: false, status: 500 });
        const { service } = createService({ fetchFn });

        await expect(
          service.trackEventOrThrow({ userId: "user-123", event: "joined_organization" }),
        ).rejects.toThrow("HTTP 500");

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(
          JSON.parse(fetchFn.mock.calls[0]![1].body).batch.map((c: { type: string }) => c.type),
        ).toEqual(["identify"]);
      });

      it("rejects with the failure and sends nothing, so a claiming caller retries", async () => {
        const { service, fetchFn } = createService({ users: failingUsers() });

        await expect(
          service.batchOrThrow([{ type: "identify", userId: "user-1", traits: {} }]),
        ).rejects.toBe(readFailure);
        await expect(
          service.trackEventOrThrow({ userId: "user-1", event: "joined_organization" }),
        ).rejects.toBe(readFailure);

        expect(fetchFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a channel with no API key", () => {
    it("reads no address, since nothing would be sent", async () => {
      const { service, fetchFn, reads } = createService({ apiKey: "" });

      await service.identifyUser({ userId: "user-1", traits: { has_traces: true } });
      await service.batchOrThrow([{ type: "track", userId: "user-1", event: "signed_up" }]);

      expect(reads).toEqual([]);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe("when created with a falsy API key", () => {
    it("behaves as a no-op without making HTTP requests", async () => {
      const fetchFn = createMockFetch();
      const service = NurturingService.create({
        users: peopleWithEmails(),
        channel: HttpCustomerIoChannel.create({
          config: { customerIoApiKey: undefined, customerIoRegion: "us" },
          fetchFn,
        }),
      });

      await service.identifyUser({
        userId: "user-123",
        traits: { email: "test@example.com" },
      });

      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
