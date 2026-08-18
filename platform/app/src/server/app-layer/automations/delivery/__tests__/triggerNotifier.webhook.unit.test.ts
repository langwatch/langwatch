import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/webhooks/httpDestination", () => ({
  sendHttpDestination: vi.fn(),
}));
vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, resetAt: 0 })),
}));
vi.mock("~/server/mailer/emailSender", () => ({
  sendEmail: vi.fn(),
  computeDefaultFrom: () => "noreply@langwatch.test",
}));

import { AlertType } from "~/generated/prisma/client";
import { sendHttpDestination } from "~/server/webhooks/httpDestination";
import {
  type TestFireTriggerInput,
  testFireTrigger,
} from "../../trigger-template.service";
import { liveTriggerNotifier } from "../triggerNotifier";

/**
 * The test fire's wire contract, driven through the REAL notifier.
 *
 * The service carries the automation's declared Content-Type, and
 * every layer between it and the socket has to carry it. A test asserting the
 * service's own call would have passed while the notifier silently dropped the
 * property and announced a plain-text body as JSON — so this drives
 * `testFireTrigger` with `liveTriggerNotifier` and reads the header off the
 * request the HTTP utility was actually handed.
 */

const mockedSend = vi.mocked(sendHttpDestination);

const sentHeaders = () =>
  mockedSend.mock.calls[0]![0].headers as Record<string, string>;
const sentBody = () => mockedSend.mock.calls[0]![0].body as string;

function testFire(
  webhookDestination: NonNullable<TestFireTriggerInput["webhookDestination"]>,
) {
  return testFireTrigger({
    deps: {
      baseHost: "https://app.langwatch.ai",
      notifier: liveTriggerNotifier,
    },
    input: {
      channel: "webhook",
      trigger: { name: "High latency", alertType: AlertType.WARNING },
      project: { name: "Acme", slug: "acme" },
      draft: {},
      recipients: [],
      webhook: null,
      webhookDestination,
    },
  });
}

const destination = {
  url: "https://example.com/hook",
  method: "POST" as const,
  headers: {},
};

beforeEach(() => {
  mockedSend.mockReset();
  mockedSend.mockResolvedValue({ status: 200, body: "", responseHeaders: {} });
});

describe("webhook test fire", () => {
  describe("given the automation declares a plain-text Content-Type", () => {
    it("posts the rendered text announced as text/plain in UTF-8", async () => {
      await testFire({
        ...destination,
        contentType: "text/plain; charset=utf-8",
        bodyTemplate: "ALERT {{ trigger.name }}",
      });

      expect(sentBody()).toBe("ALERT High latency");
      expect(sentHeaders()["Content-Type"]).toBe("text/plain; charset=utf-8");
    });
  });

  describe("given the automation keeps the JSON Content-Type", () => {
    it("posts the rendered envelope announced as application/json", async () => {
      await testFire({
        ...destination,
        contentType: "application/json",
        bodyTemplate: null,
      });

      expect(JSON.parse(sentBody())).toMatchObject({
        event: "trigger.matched",
      });
      expect(sentHeaders()["Content-Type"]).toBe("application/json");
    });
  });

  describe("given an automation saved before content types existed", () => {
    /** @scenario "An automation saved before content types existed still sends JSON" */
    it("posts JSON, announced exactly as it always was", async () => {
      await testFire({ ...destination, bodyTemplate: null });

      expect(JSON.parse(sentBody())).toMatchObject({
        event: "trigger.matched",
      });
      expect(sentHeaders()["Content-Type"]).toBe("application/json");
    });
  });

  describe("when the author presses Send a test", () => {
    /** @scenario "A test fire sends the rendered request to the configured endpoint" */
    it("posts the rendered body to the configured URL with a test-fire marker", async () => {
      await testFire({
        ...destination,
        contentType: "text/plain; charset=utf-8",
        bodyTemplate: "ALERT {{ trigger.name }}",
      });

      expect(mockedSend.mock.calls[0]![0].url).toBe("https://example.com/hook");
      expect(sentBody()).toBe("ALERT High latency");
      // Non-suppressible: the destination below sets no headers, and a
      // customer header of this name is stripped as reserved either way.
      expect(sentHeaders()["X-LangWatch-Test-Fire"]).toBe("true");
    });
  });
});
