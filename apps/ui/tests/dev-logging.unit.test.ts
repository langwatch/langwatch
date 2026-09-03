/**
 * @vitest-environment node
 *
 * The dev server's own lane format, and the one place the proxy's failures are
 * collapsed.
 *
 * Corresponds to specs/setup/dev-stack-log-format.feature.
 */

import { describe, expect, it } from "vitest";

import { createDevLogger, devLogLine, timeOfDay } from "../vite/dev-logging";

const AT = new Date(2026, 8, 3, 13, 10, 46, 108);

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
    /** @scenario "The dev server prints the same shape as everything else" */
    it("reads as a time, a level, the scope and a message", () => {
      expect(devLogLine({ level: "info", message: "ready in 812 ms", at: AT })).toBe(
        "[13:10:46.108] INFO (vite): ready in 812 ms",
      );
      expect(devLogLine({ level: "warn", message: "a warning", at: AT })).toBe(
        "[13:10:46.108] WARN (vite): a warning",
      );
      expect(devLogLine({ level: "error", message: "a failure", at: AT })).toBe(
        "[13:10:46.108] ERROR (vite): a failure",
      );
    });

    /** @scenario "The dev server prints the same shape as everything else" */
    it("carries no twelve-hour clock and no bracketed lane name", () => {
      const line = devLogLine({ level: "info", message: "ready", at: AT });

      expect(line).not.toMatch(/AM|PM/);
      expect(line).not.toContain("[vite]");
      expect(timeOfDay(AT)).toBe("13:10:46.108");
    });

    /** @scenario "The dev server prints the same shape as everything else" */
    it("leaves the rest of a multi-line message as it was written", () => {
      expect(devLogLine({ level: "info", message: "first\n  second", at: AT })).toBe(
        "[13:10:46.108] INFO (vite): first\n  second",
      );
    });
  });
});

describe("given the browser relaying an error through the dev server", () => {
  describe("when the dev server writes it", () => {
    /** @scenario "What the browser reports through the dev server still arrives" */
    it("passes the relay through as one line", () => {
      const { logger, err } = testLogger();

      logger.error("(client) [console.error] something the page said");

      expect(err).toEqual([
        "[13:10:46.108] ERROR (vite): (client) [console.error] something the page said",
      ]);
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
          `\u001b[31mhttp proxy error: /api/trpc/health\u001b[0m\nAggregateError\n    at internalConnectMultiple`,
          { error: new Error("connect ECONNREFUSED 127.0.0.1:6560") },
        );
      }

      expect(err).toEqual([
        "[13:10:46.118] ERROR (vite): api not reachable at http://localhost:6560 for /api/trpc/health",
      ]);
    });

    /** @scenario "An unreachable API is one line, not a stack trace per request" */
    it("collapses a failed websocket upgrade the same way", () => {
      const { logger, err } = testLogger();

      logger.error("\u001b[31mws proxy error:\u001b[0m\nError: connect ECONNREFUSED");

      expect(err).toEqual([
        "[13:10:46.108] ERROR (vite): api not reachable at http://localhost:6560 for the websocket upgrade",
      ]);
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

      expect(err).toEqual([
        "[13:10:46.108] ERROR (vite): api not reachable at http://localhost:6560 for /api/one",
        "[13:10:51.109] ERROR (vite): api not reachable at http://localhost:6560 for /api/three",
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

      expect(err).toEqual(["[13:10:46.108] ERROR (vite): Internal server error\n    at somewhere"]);
    });
  });
});
