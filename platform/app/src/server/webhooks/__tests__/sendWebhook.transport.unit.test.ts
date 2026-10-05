import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../httpDestination", () => ({ sendHttpDestination: vi.fn() }));

import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { sendHttpDestination } from "../httpDestination";
import { assertWebhookDelivered, sendWebhook } from "../sendWebhook";
import { describeTransportFailure } from "../transportFailure";

const mockedSend = vi.mocked(sendHttpDestination);

function transportFailure(cause: Error): DispatchError {
  return new DispatchError({
    message: `Webhook for trigger "Timeout watcher": HTTP request failed — ${cause.message}`,
    retryable: true,
    cause,
  });
}

async function testFire(): Promise<DispatchError> {
  const error = await sendWebhook({
    url: "https://hooks.example.com/in",
    body: "{}",
    triggerName: "Timeout watcher",
    testFire: true,
  }).catch((e: unknown) => e);
  if (!(error instanceof DispatchError)) {
    throw new Error("expected the test fire to raise a DispatchError");
  }
  return error;
}

describe("sendWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the endpoint cannot be reached", () => {
    /** @scenario "A test that cannot reach the endpoint names the transport failure" */
    it.each([
      {
        cause: new Error("Could not resolve hostname: hooks.example.com"),
        named: /hostname could not be resolved/,
      },
      {
        cause: new Error(
          "Connection refused - is the server running at 203.0.113.9:443?",
        ),
        named: /refused the connection/,
      },
      {
        cause: new Error(
          "Connection failed to 203.0.113.9:443: The operation was aborted due to timeout",
        ),
        named: /did not answer in time/,
      },
      {
        cause: new Error(
          "TLS certificate error for hooks.example.com: certificate has expired",
        ),
        named: /TLS certificate could not be verified/,
      },
    ])("names the failure for $cause.message", async ({ cause, named }) => {
      mockedSend.mockRejectedValue(transportFailure(cause));

      const error = await testFire();

      expect(error.customerMessage).toMatch(named);
      expect(error.customerMessage).not.toMatch(/example\.com|203\.0\.113/);
      expect(error.retryable).toBe(true);
    });
  });

  describe("when the failure says nothing recognisable", () => {
    it("says the endpoint could not be reached", async () => {
      mockedSend.mockRejectedValue(transportFailure(new Error("kaboom")));

      const error = await testFire();

      expect(error.customerMessage).toBe("The endpoint could not be reached.");
    });
  });
});

describe("describeTransportFailure", () => {
  describe("given only the trigger name mentions a timeout", () => {
    it("reads the cause, not the label", () => {
      expect(describeTransportFailure(new Error("ECONNRESET"))).toMatch(
        /closed the connection/,
      );
    });
  });

  describe("given an undici error whose code sits on its cause", () => {
    it("reads the code from the cause", () => {
      const error = new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
      });
      expect(describeTransportFailure(error)).toMatch(/refused the connection/);
    });
  });
});

describe("assertWebhookDelivered", () => {
  describe("when the endpoint answers 500", () => {
    /** @scenario "A test answered with an error status names the status" */
    it("says the endpoint answered HTTP 500", () => {
      const error = (() => {
        try {
          assertWebhookDelivered({
            result: {
              status: 500,
              body: "internal detail",
              retryAfterMs: undefined,
            },
            triggerName: "Timeout watcher",
          });
        } catch (e) {
          return e;
        }
      })();

      expect(error).toBeInstanceOf(DispatchError);
      expect(error).toMatchObject({
        customerMessage: "The endpoint answered HTTP 500.",
      });
    });
  });
});
