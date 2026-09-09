/**
 * The dev server's own lane format, and the one place the proxy's failures are
 * collapsed.
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";

import { createDevLogger, devLogLine, devLogRecord } from "../vite/dev-logging";

const AT = new Date(2026, 8, 3, 13, 10, 46, 108);
const AT_ISO = AT.toISOString();

/** A logger writing into arrays, and the clock it reads. */
function testLogger(options: { quietMs?: number } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let clock = AT.getTime();
  const logger = createDevLogger({
    proxyTarget: "http://localhost:6560",
    quietMs: options.quietMs ?? 5_000,
    now: () => clock,
    sink: { out: (line) => out.push(line), err: (line) => err.push(line) },
  });
  return {
    logger,
    out,
    err,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("given the browser application's dev server logging", () => {
  describe("when it writes a line", () => {
    /** @scenario "The browser lane's dev server writes the shared format" */
    it("is the same structured JSON every other lane writes", () => {
      expect(devLogRecord({ level: "info", message: "ready in 812 ms", at: AT })).toEqual({
        time: AT_ISO,
        level: "info",
        msg: "ready in 812 ms",
        service: "langwatch-ui",
      });
      expect(devLogRecord({ level: "warn", message: "a warning", at: AT })).toEqual({
        time: AT_ISO,
        level: "warn",
        msg: "a warning",
        service: "langwatch-ui",
      });
      expect(devLogRecord({ level: "error", message: "a failure", at: AT })).toEqual({
        time: AT_ISO,
        level: "error",
        msg: "a failure",
        service: "langwatch-ui",
      });
    });

    /** @scenario "The browser lane's dev server writes the shared format" */
    it("carries no twelve-hour clock and no bracketed lane name", () => {
      const line = devLogLine({ level: "info", message: "[vite] ready", at: AT });

      expect(line).not.toBeNull();
      expect(line).not.toMatch(/AM|PM/);
      expect(line).not.toContain("[vite]");
      expect(JSON.parse(line as string).msg).toBe("ready");
    });

    /** @scenario "The browser lane's dev server writes the shared format" */
    it("strips Vite's own ANSI colour from the message", () => {
      const record = devLogRecord({
        level: "info",
        message: "[32mready[0m in 812 ms",
        at: AT,
      });

      expect(record?.msg).toBe("ready in 812 ms");
    });

    /** @scenario "The browser lane's dev server writes the shared format" */
    it("joins a multi-line message into one record's msg, not one line per record", () => {
      expect(devLogRecord({ level: "info", message: "first\n  second", at: AT })).toEqual({
        time: AT_ISO,
        level: "info",
        msg: "first\n  second",
        service: "langwatch-ui",
      });
    });

    /** @scenario "The browser lane's dev server writes the shared format" */
    it("splits a multi-line error into msg and stack", () => {
      expect(
        devLogRecord({ level: "error", message: "boom\n    at run (job.ts:1:1)", at: AT }),
      ).toEqual({
        time: AT_ISO,
        level: "error",
        msg: "boom",
        service: "langwatch-ui",
        stack: "    at run (job.ts:1:1)",
      });
    });

    /** @scenario "The browser lane's dev server writes the shared format" */
    it("drops a blank-only message rather than writing an empty record", () => {
      expect(devLogRecord({ level: "info", message: "", at: AT })).toBeNull();
      expect(devLogRecord({ level: "info", message: "\n  \n", at: AT })).toBeNull();
      expect(devLogLine({ level: "info", message: "   ", at: AT })).toBeNull();
    });
  });
});

describe("given the browser relaying an error through the dev server", () => {
  describe("when the dev server writes it", () => {
    /** @scenario "What the browser reports through the dev server still arrives" */
    it("passes the relay through as one line", () => {
      const { logger, err } = testLogger();

      logger.error("(client) [console.error] something the page said");

      expect(err).toHaveLength(1);
      expect(JSON.parse(err[0] as string)).toEqual({
        time: AT_ISO,
        level: "error",
        msg: "(client) [console.error] something the page said",
        service: "langwatch-ui",
      });
    });
  });
});

describe("given the api lane is not listening", () => {
  describe("when the browser makes many requests through the dev server", () => {
    /** @scenario "An unreachable API is one line, not a stack trace per request" */
    it("says once where it tried, rather than a stack per request", () => {
      const { logger, err, advance } = testLogger();

      for (let request = 0; request < 20; request += 1) {
        advance(10);
        logger.error(
          `[31mhttp proxy error: /api/trpc/health[0m\nAggregateError\n    at internalConnectMultiple`,
          { error: new Error("connect ECONNREFUSED 127.0.0.1:6560") },
        );
      }

      expect(err).toHaveLength(1);
      expect(JSON.parse(err[0] as string).msg).toBe(
        "api not reachable at http://localhost:6560 for /api/trpc/health",
      );
    });

    /** @scenario "An unreachable API is one line, not a stack trace per request" */
    it("collapses a failed websocket upgrade the same way", () => {
      const { logger, err } = testLogger();

      logger.error("[31mws proxy error:[0m\nError: connect ECONNREFUSED");

      expect(err).toHaveLength(1);
      expect(JSON.parse(err[0] as string).msg).toBe(
        "api not reachable at http://localhost:6560 for the websocket upgrade",
      );
    });
  });
});

describe("given the api lane has been unreachable for some time", () => {
  describe("when another request fails", () => {
    /** @scenario "A proxy that stays down says so again after a while" */
    it("reports it again, so a stack that never came up is not silent forever", () => {
      const { logger, err, advance } = testLogger({ quietMs: 5_000 });

      logger.error("http proxy error: /api/one\nstack");
      advance(4_999);
      logger.error("http proxy error: /api/two\nstack");
      advance(2);
      logger.error("http proxy error: /api/three\nstack");

      expect(err.map((line) => JSON.parse(line).msg)).toEqual([
        "api not reachable at http://localhost:6560 for /api/one",
        "api not reachable at http://localhost:6560 for /api/three",
      ]);
    });
  });
});

describe("given an error that is not the proxy's", () => {
  describe("when the dev server logs it", () => {
    /** @scenario "An unreachable API is one line, not a stack trace per request" */
    it("prints it in full, because it is not the failure being collapsed", () => {
      const { logger, err } = testLogger();

      logger.error("Internal server error\n    at somewhere");

      expect(err).toHaveLength(1);
      expect(JSON.parse(err[0] as string)).toEqual({
        time: AT_ISO,
        level: "error",
        msg: "Internal server error",
        service: "langwatch-ui",
        stack: "    at somewhere",
      });
    });
  });
});
