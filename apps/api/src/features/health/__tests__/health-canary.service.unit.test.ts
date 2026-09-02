import { HandledError } from "@langwatch/handled-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

import { sendCanary } from "../health-canary.service";

function canary() {
  return sendCanary({
    probe: "collector",
    transport: "rest",
    url: "https://example.invalid/api/collector",
    authToken: "token",
    body: { hello: "world" },
  });
}

describe("sendCanary", () => {
  beforeEach(() => {
    logger.error.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when the POST fails at the network level", () => {
    /** @scenario A canary the collector never answers is reported as our failure */
    it("fails with the health check code, attributed to the platform", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
      );

      const error = await canary().catch((e: unknown) => e);

      expect(HandledError.isHandled(error)).toBe(true);
      const handled = error as HandledError;
      expect(handled.code).toBe("health_check_failed");
      expect(handled.fault).toBe("platform");
      expect(handled.httpStatus).toBe(500);
      expect(handled.meta).toMatchObject({
        check: "collector",
        transport: "rest",
      });
    });

    /** @scenario The cause of a transport failure survives in the log */
    it("logs the underlying cause, which the wire would otherwise mask", async () => {
      const cause = new Error("connect ECONNREFUSED");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));

      await canary().catch(() => undefined);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          probe: "collector",
          transport: "rest",
          error: cause,
        }),
        expect.stringContaining("transport failed"),
      );
    });
  });

  describe("when our own boundary refuses the canary", () => {
    /** @scenario A canary our own boundary refuses names the status it was refused with */
    it("carries the upstream status for the alert to read", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 503 }),
      );

      const error = (await canary().catch((e: unknown) => e)) as HandledError;

      expect(error.code).toBe("health_check_failed");
      expect(error.meta).toMatchObject({
        check: "collector",
        transport: "rest",
        upstreamStatus: 503,
      });
    });
  });

  describe("when the canary succeeds", () => {
    it("returns the response for the probe to read", async () => {
      const response = { ok: true, status: 200 };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      await expect(canary()).resolves.toBe(response);
    });

    /** @scenario A canary that hangs is not waited on forever */
    it("gives the request a deadline rather than holding it open", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);

      await canary();

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
